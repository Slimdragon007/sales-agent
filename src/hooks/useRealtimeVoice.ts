import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  type RealtimeItem,
} from "@openai/agents/realtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { SLIM_SALES_AGENT_INSTRUCTIONS } from "../agent/instructions";
import type { TranscriptTurn } from "../domain/call-state";
import {
  applyRealtimeTimingEvent,
  createRealtimeTimingState,
  getInboundAudioQuality,
  type LatencyMeasurements,
} from "../domain/latency";
import { parseRealtimeUsage } from "../lib/realtime-usage";
import {
  createRealtimeLease,
  releaseRealtimeLease,
  type RuntimeSafety,
} from "../lib/runtime-safety";
import { performVoiceSessionDisconnect } from "../lib/voice-session-disconnect";
import { canRequestPaidClientSecret } from "../lib/voice-session-controls";

type VoiceStatus =
  "offline" | "connecting" | "connected" | "speaking" | "error";

export type RealtimeVoiceMetrics = LatencyMeasurements;

type UseRealtimeVoiceOptions = {
  initialMetrics: RealtimeVoiceMetrics;
  safety: RuntimeSafety | null;
  onTranscript: (turns: TranscriptTurn[]) => void;
  onUsage: (usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }) => void;
};

const AUDIO_QUALITY_SAMPLE_INTERVAL_MS = 5_000;

function getMessageText(item: RealtimeItem): string | null {
  if (item.type !== "message") {
    return null;
  }

  const text = item.content
    .map((content) => {
      if (content.type === "input_text" || content.type === "output_text") {
        return content.text;
      }

      if (
        (content.type === "input_audio" || content.type === "output_audio") &&
        content.transcript
      ) {
        return content.transcript;
      }

      return "";
    })
    .join(" ")
    .trim();

  return text.length > 0 ? text : null;
}

function historyToTranscript(history: RealtimeItem[]): TranscriptTurn[] {
  const timestamp = new Date().toISOString();

  return history.flatMap((item) => {
    if (item.type !== "message" || item.role === "system") {
      return [];
    }

    const text = getMessageText(item);

    if (!text) {
      return [];
    }

    return [
      {
        id: item.itemId,
        speaker:
          item.role === "user" ? ("prospect" as const) : ("agent" as const),
        speakerName: item.role === "user" ? "Prospect" : "Slim Sales Agent",
        text,
        timestamp,
      },
    ];
  });
}

export function useRealtimeVoice({
  initialMetrics,
  safety,
  onTranscript,
  onUsage,
}: UseRealtimeVoiceOptions) {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const leaseIdRef = useRef<string | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const lastAudioQualityRef = useRef({
    concealmentEvents: 0,
    nonSilentConcealedSamples: 0,
  });
  const lastAudioQualitySampleAtRef = useRef<number | null>(null);
  const timingRef = useRef(createRealtimeTimingState());
  const [status, setStatus] = useState<VoiceStatus>("offline");
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<RealtimeVoiceMetrics>(() => ({
    ...initialMetrics,
    connectionMs: [...initialMetrics.connectionMs],
    firstAudioMs: [...initialMetrics.firstAudioMs],
    interruptionMs: [...initialMetrics.interruptionMs],
  }));

  const releaseLease = useCallback(() => {
    const leaseId = leaseIdRef.current;
    leaseIdRef.current = null;

    if (leaseId) {
      void releaseRealtimeLease(leaseId);
    }
  }, []);

  const disconnect = useCallback(() => {
    const clearedTimers = performVoiceSessionDisconnect(
      {
        stopTimerId: stopTimerRef.current,
        statsTimerId: statsTimerRef.current,
      },
      {
        session: sessionRef.current,
        mediaStream: mediaStreamRef.current,
      },
      {
        clearTimeout: window.clearTimeout.bind(window),
        clearInterval: window.clearInterval.bind(window),
        releaseLease,
        onDisconnected: () => {
          peerConnectionRef.current = null;
          lastAudioQualityRef.current = {
            concealmentEvents: 0,
            nonSilentConcealedSamples: 0,
          };
          lastAudioQualitySampleAtRef.current = null;
          timingRef.current = createRealtimeTimingState();
          setStatus("offline");
        },
      },
    );

    stopTimerRef.current = clearedTimers.stopTimerId;
    statsTimerRef.current = clearedTimers.statsTimerId;
    sessionRef.current = null;
    mediaStreamRef.current = null;
  }, [releaseLease]);

  const connect = useCallback(
    async (userInitiated: boolean) => {
      if (sessionRef.current || status !== "offline") {
        return;
      }

      if (
        !canRequestPaidClientSecret({
          userInitiated,
          safety,
        })
      ) {
        setError(
          userInitiated
            ? "Paid voice is locked until the project hard spend limit is confirmed."
            : "Paid voice starts only from an explicit click in Settings.",
        );
        setStatus("error");
        return;
      }

      if (!safety) {
        return;
      }

      const runtimeSafety = safety;

      setError(null);
      setStatus("connecting");

      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        mediaStreamRef.current = mediaStream;

        const lease = await createRealtimeLease();
        leaseIdRef.current = lease.leaseId;

        const agent = new RealtimeAgent({
          name: "Slim Sales Agent",
          instructions: SLIM_SALES_AGENT_INSTRUCTIONS,
        });
        const transport = new OpenAIRealtimeWebRTC({
          mediaStream,
          changePeerConnection: (peerConnection) => {
            peerConnectionRef.current = peerConnection;
            return peerConnection;
          },
        });
        const session = new RealtimeSession(agent, {
          transport,
          model: runtimeSafety.realtimeModel,
          config: {
            outputModalities: ["audio"],
            reasoning: { effort: "low" },
            audio: {
              input: {
                transcription: { model: "gpt-4o-mini-transcribe" },
                noiseReduction: { type: "near_field" },
                turnDetection: {
                  type: "semantic_vad",
                  eagerness: "auto",
                  createResponse: true,
                  interruptResponse: true,
                },
              },
              output: { voice: "marin" },
            },
          },
          historyStoreAudio: false,
          tracingDisabled: false,
          workflowName: "Slim Sales Agent v1 role-play",
        });

        const handleTimingEvent = (eventType: string): void => {
          const update = applyRealtimeTimingEvent(
            timingRef.current,
            eventType,
            performance.now(),
          );
          timingRef.current = update.state;

          if (
            eventType === "output_audio_buffer.started" ||
            eventType === "sdk.audio_start"
          ) {
            setStatus("speaking");
          }
          if (
            eventType === "output_audio_buffer.cleared" ||
            eventType === "output_audio_buffer.stopped" ||
            eventType === "sdk.audio_stopped" ||
            eventType === "sdk.audio_interrupted"
          ) {
            setStatus("connected");
          }
          if (update.firstAudioMs !== null || update.interruptionMs !== null) {
            setMetrics((current) => ({
              ...current,
              firstAudioMs:
                update.firstAudioMs === null
                  ? current.firstAudioMs
                  : [...current.firstAudioMs, update.firstAudioMs],
              interruptionMs:
                update.interruptionMs === null
                  ? current.interruptionMs
                  : [...current.interruptionMs, update.interruptionMs],
            }));
          }
        };

        session.on("history_updated", (history) => {
          onTranscript(historyToTranscript(history));
        });
        session.on("audio_start", () => {
          handleTimingEvent("sdk.audio_start");
        });
        session.on("audio_stopped", () => {
          handleTimingEvent("sdk.audio_stopped");
        });
        session.on("audio_interrupted", () => {
          handleTimingEvent("sdk.audio_interrupted");
        });
        session.on("transport_event", (event) => {
          if (
            event.type === "input_audio_buffer.speech_stopped" ||
            event.type === "input_audio_buffer.speech_started" ||
            event.type === "output_audio_buffer.started" ||
            event.type === "output_audio_buffer.stopped" ||
            event.type === "output_audio_buffer.cleared"
          ) {
            handleTimingEvent(event.type);
          }
        });
        session.on("agent_end", () => {
          const usage = parseRealtimeUsage(session.usage);
          if (usage) {
            onUsage(usage);
          }
        });
        session.on("error", ({ error: sessionError }) => {
          const message =
            sessionError instanceof Error
              ? sessionError.message
              : "The live voice session reported an error.";

          disconnect();
          setError(message);
          setStatus("error");
        });

        sessionRef.current = session;
        const connectionStartedAt = performance.now();
        await session.connect({
          apiKey: lease.clientSecret,
        });

        const connectionMs = performance.now() - connectionStartedAt;
        setMetrics((current) => ({
          ...current,
          connectionMs: [...current.connectionMs, connectionMs],
        }));
        setStatus("connected");

        lastAudioQualityRef.current = {
          concealmentEvents: 0,
          nonSilentConcealedSamples: 0,
        };
        lastAudioQualitySampleAtRef.current = performance.now();
        statsTimerRef.current = window.setInterval(() => {
          const peerConnection = peerConnectionRef.current;

          if (!peerConnection) {
            return;
          }

          void peerConnection
            .getStats()
            .then((reports) => {
              if (peerConnectionRef.current !== peerConnection) {
                return;
              }

              const quality = getInboundAudioQuality(reports);

              if (quality === null) {
                return;
              }

              const now = performance.now();
              const priorSampleAt = lastAudioQualitySampleAtRef.current;
              const observedMs =
                priorSampleAt === null ? 0 : Math.max(0, now - priorSampleAt);
              const newConcealmentEvents = Math.max(
                0,
                quality.concealmentEvents -
                  lastAudioQualityRef.current.concealmentEvents,
              );
              const newNonSilentConcealedSamples = Math.max(
                0,
                quality.nonSilentConcealedSamples -
                  lastAudioQualityRef.current.nonSilentConcealedSamples,
              );
              lastAudioQualityRef.current = quality;
              lastAudioQualitySampleAtRef.current = now;
              setMetrics((current) => ({
                ...current,
                audioConcealmentEvents:
                  current.audioConcealmentEvents + newConcealmentEvents,
                nonSilentConcealedSamples:
                  current.nonSilentConcealedSamples +
                  newNonSilentConcealedSamples,
                audioQualityObservedMs:
                  current.audioQualityObservedMs + observedMs,
              }));
            })
            .catch(() => {
              // A closing peer connection can reject an in-flight stats sample.
            });
        }, AUDIO_QUALITY_SAMPLE_INTERVAL_MS);

        const remainingLeaseMs = Math.max(0, lease.expiresAt - Date.now());
        stopTimerRef.current = window.setTimeout(disconnect, remainingLeaseMs);
      } catch (connectionError) {
        sessionRef.current?.close();
        sessionRef.current = null;
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        peerConnectionRef.current = null;
        releaseLease();
        const isMicrophonePermissionDenied =
          connectionError instanceof DOMException &&
          connectionError.name === "NotAllowedError";
        setError(
          isMicrophonePermissionDenied
            ? "Microphone access is blocked. Close the voice workspace, open the iPhone app settings, allow Microphone, then try again."
            : connectionError instanceof Error
              ? connectionError.message
              : "Could not connect the live voice session.",
        );
        setStatus("error");
      }
    },
    [disconnect, onTranscript, onUsage, releaseLease, safety, status],
  );

  const resetError = useCallback(() => {
    setError(null);
    setStatus("offline");
  }, []);

  useEffect(() => disconnect, [disconnect]);

  return {
    status,
    error,
    metrics,
    connect,
    disconnect,
    emergencyStop: disconnect,
    resetError,
  };
}
