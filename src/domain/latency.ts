export type LatencyMeasurements = {
  connectionMs: number[];
  firstAudioMs: number[];
  interruptionMs: number[];
  audioConcealmentEvents: number;
  nonSilentConcealedSamples: number;
  audioQualityObservedMs: number;
};

export type InboundAudioQuality = {
  concealmentEvents: number;
  nonSilentConcealedSamples: number;
};

export type LatencyGateResult = {
  ready: boolean;
  measurementsComplete: boolean;
  checks: {
    connectionP95: number | null;
    firstAudioMedian: number | null;
    firstAudioP95: number | null;
    interruptionP95: number | null;
    audioConcealmentEvents: number;
    nonSilentConcealedSamples: number;
    audioQualityObservedMs: number;
  };
  failures: string[];
};

export type RealtimeTimingState = {
  agentSpeaking: boolean;
  speechEndedAt: number | null;
  interruptionStartedAt: number | null;
};

export type RealtimeTimingUpdate = {
  state: RealtimeTimingState;
  firstAudioMs: number | null;
  interruptionMs: number | null;
};

export const REQUIRED_ROLE_PLAY_SAMPLES = 20;
export const REQUIRED_INTERRUPTION_SAMPLES = 20;
export const REQUIRED_AUDIO_QUALITY_MS = 5 * 60 * 1_000;

function ordered(values: number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

export function createRealtimeTimingState(): RealtimeTimingState {
  return {
    agentSpeaking: false,
    speechEndedAt: null,
    interruptionStartedAt: null,
  };
}

export function applyRealtimeTimingEvent(
  current: RealtimeTimingState,
  eventType: string,
  now: number,
): RealtimeTimingUpdate {
  const state = { ...current };
  let firstAudioMs: number | null = null;
  let interruptionMs: number | null = null;

  if (eventType === "input_audio_buffer.speech_stopped") {
    state.speechEndedAt = now;
  }

  if (
    eventType === "output_audio_buffer.started" ||
    eventType === "sdk.audio_start"
  ) {
    state.agentSpeaking = true;

    if (state.speechEndedAt !== null) {
      firstAudioMs = Math.max(0, now - state.speechEndedAt);
      state.speechEndedAt = null;
    }
  }

  if (
    eventType === "input_audio_buffer.speech_started" &&
    state.agentSpeaking &&
    state.interruptionStartedAt === null
  ) {
    state.interruptionStartedAt = now;
  }

  if (
    eventType === "output_audio_buffer.cleared" ||
    eventType === "output_audio_buffer.stopped" ||
    eventType === "sdk.audio_stopped" ||
    eventType === "sdk.audio_interrupted"
  ) {
    state.agentSpeaking = false;

    if (state.interruptionStartedAt !== null) {
      interruptionMs = Math.max(0, now - state.interruptionStartedAt);
      state.interruptionStartedAt = null;
    }
  }

  return { state, firstAudioMs, interruptionMs };
}

export function getInboundAudioQuality(
  reports: RTCStatsReport,
): InboundAudioQuality | null {
  let concealmentEvents = 0;
  let nonSilentConcealedSamples = 0;
  let supported = false;

  reports.forEach((report) => {
    const inbound = report as RTCInboundRtpStreamStats;
    const isAudio = inbound.type === "inbound-rtp" && inbound.kind === "audio";

    if (
      isAudio &&
      typeof inbound.concealmentEvents === "number" &&
      typeof inbound.concealedSamples === "number" &&
      typeof inbound.silentConcealedSamples === "number"
    ) {
      supported = true;
      concealmentEvents += inbound.concealmentEvents;
      nonSilentConcealedSamples += Math.max(
        0,
        inbound.concealedSamples - inbound.silentConcealedSamples,
      );
    }
  });

  return supported ? { concealmentEvents, nonSilentConcealedSamples } : null;
}

export function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = ordered(values);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function getMedian(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = ordered(values);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];

  if (current === undefined) {
    return null;
  }

  if (sorted.length % 2 === 1) {
    return current;
  }

  const previous = sorted[middle - 1];
  return previous === undefined ? current : (previous + current) / 2;
}

export function evaluateLatencyGates(
  measurements: LatencyMeasurements,
): LatencyGateResult {
  const checks = {
    connectionP95: percentile(measurements.connectionMs, 0.95),
    firstAudioMedian: getMedian(measurements.firstAudioMs),
    firstAudioP95: percentile(measurements.firstAudioMs, 0.95),
    interruptionP95: percentile(measurements.interruptionMs, 0.95),
    audioConcealmentEvents: measurements.audioConcealmentEvents,
    nonSilentConcealedSamples: measurements.nonSilentConcealedSamples,
    audioQualityObservedMs: measurements.audioQualityObservedMs,
  };
  const measurementsComplete =
    measurements.connectionMs.length >= REQUIRED_ROLE_PLAY_SAMPLES &&
    measurements.firstAudioMs.length >= REQUIRED_ROLE_PLAY_SAMPLES &&
    measurements.interruptionMs.length >= REQUIRED_INTERRUPTION_SAMPLES &&
    checks.audioQualityObservedMs >= REQUIRED_AUDIO_QUALITY_MS;
  const failures: string[] = [];

  if (!measurementsComplete) {
    failures.push("Latency measurements are incomplete.");
  }
  if (checks.connectionP95 !== null && checks.connectionP95 > 2_500) {
    failures.push("P95 connection time exceeds 2,500 ms.");
  }
  if (checks.firstAudioMedian !== null && checks.firstAudioMedian > 700) {
    failures.push("Median first-audio time exceeds 700 ms.");
  }
  if (checks.firstAudioP95 !== null && checks.firstAudioP95 > 1_200) {
    failures.push("P95 first-audio time exceeds 1,200 ms.");
  }
  if (checks.interruptionP95 !== null && checks.interruptionP95 > 250) {
    failures.push("P95 interruption cutoff exceeds 250 ms.");
  }
  if (checks.nonSilentConcealedSamples > 0) {
    failures.push("Non-silent WebRTC audio samples were concealed.");
  }

  return {
    ready: measurementsComplete && failures.length === 0,
    measurementsComplete,
    checks,
    failures,
  };
}
