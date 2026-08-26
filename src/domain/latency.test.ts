import { describe, expect, it } from "vitest";
import {
  applyRealtimeTimingEvent,
  createRealtimeTimingState,
  evaluateLatencyGates,
  getInboundAudioQuality,
  getMedian,
  percentile,
  REQUIRED_AUDIO_QUALITY_MS,
  REQUIRED_INTERRUPTION_SAMPLES,
  REQUIRED_ROLE_PLAY_SAMPLES,
} from "./latency";

describe("latency release gates", () => {
  it("calculates median and nearest-rank P95 deterministically", () => {
    expect(getMedian([900, 500, 700, 600])).toBe(650);
    expect(percentile([100, 200, 300, 400, 500], 0.95)).toBe(500);
  });

  it("does not release without every measurement", () => {
    const result = evaluateLatencyGates({
      connectionMs: [1_100],
      firstAudioMs: [620],
      interruptionMs: [],
      audioConcealmentEvents: 0,
      nonSilentConcealedSamples: 0,
      audioQualityObservedMs: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.failures).toContain("Latency measurements are incomplete.");
  });

  it("passes measurements within every target", () => {
    const result = evaluateLatencyGates({
      connectionMs: Array.from(
        { length: REQUIRED_ROLE_PLAY_SAMPLES },
        () => 1_400,
      ),
      firstAudioMs: Array.from(
        { length: REQUIRED_ROLE_PLAY_SAMPLES },
        () => 620,
      ),
      interruptionMs: Array.from(
        { length: REQUIRED_INTERRUPTION_SAMPLES },
        () => 140,
      ),
      audioConcealmentEvents: 1,
      nonSilentConcealedSamples: 0,
      audioQualityObservedMs: REQUIRED_AUDIO_QUALITY_MS,
    });

    expect(result.ready).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("reports each failed latency target", () => {
    const result = evaluateLatencyGates({
      connectionMs: Array.from(
        { length: REQUIRED_ROLE_PLAY_SAMPLES },
        () => 2_800,
      ),
      firstAudioMs: Array.from(
        { length: REQUIRED_ROLE_PLAY_SAMPLES },
        (_, index) => (index % 2 === 0 ? 710 : 1_400),
      ),
      interruptionMs: Array.from(
        { length: REQUIRED_INTERRUPTION_SAMPLES },
        () => 320,
      ),
      audioConcealmentEvents: 1,
      nonSilentConcealedSamples: 1,
      audioQualityObservedMs: REQUIRED_AUDIO_QUALITY_MS,
    });

    expect(result.ready).toBe(false);
    expect(result.failures).toEqual([
      "P95 connection time exceeds 2,500 ms.",
      "Median first-audio time exceeds 700 ms.",
      "P95 first-audio time exceeds 1,200 ms.",
      "P95 interruption cutoff exceeds 250 ms.",
      "Non-silent WebRTC audio samples were concealed.",
    ]);
  });

  it("measures WebRTC playback start and interruption cutoff events", () => {
    let timing = createRealtimeTimingState();

    timing = applyRealtimeTimingEvent(
      timing,
      "input_audio_buffer.speech_stopped",
      1_000,
    ).state;
    const firstAudio = applyRealtimeTimingEvent(
      timing,
      "output_audio_buffer.started",
      1_640,
    );
    expect(firstAudio.firstAudioMs).toBe(640);

    timing = applyRealtimeTimingEvent(
      firstAudio.state,
      "input_audio_buffer.speech_started",
      2_000,
    ).state;
    const interrupted = applyRealtimeTimingEvent(
      timing,
      "output_audio_buffer.cleared",
      2_180,
    );
    expect(interrupted.interruptionMs).toBe(180);
    expect(interrupted.state.agentSpeaking).toBe(false);
  });

  it("reads audio concealment events from inbound WebRTC statistics", () => {
    const reports = {
      forEach: (callback: (report: RTCStats) => void) => {
        callback({
          id: "audio-inbound",
          timestamp: 1,
          type: "inbound-rtp",
          kind: "audio",
          concealedSamples: 10,
          concealmentEvents: 2,
          silentConcealedSamples: 8,
        } as RTCInboundRtpStreamStats);
        callback({
          id: "video-inbound",
          timestamp: 1,
          type: "inbound-rtp",
          kind: "video",
          concealedSamples: 20,
          concealmentEvents: 10,
          silentConcealedSamples: 0,
        } as RTCInboundRtpStreamStats);
      },
    } as unknown as RTCStatsReport;

    expect(getInboundAudioQuality(reports)).toEqual({
      concealmentEvents: 2,
      nonSilentConcealedSamples: 2,
    });
  });
});
