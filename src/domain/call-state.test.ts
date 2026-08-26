import { describe, expect, it } from "vitest";
import {
  canAdvanceTo,
  createCortezFixtureState,
  getMinimumDiscoveryMissing,
  getRecommendedNextQuestion,
  METRICS_TELEMETRY_VERSION,
  parsePersistedCallState,
  reduceCallState,
} from "./call-state";

describe("call state", () => {
  it("preserves unknown facts instead of inventing values", () => {
    const state = createCortezFixtureState();

    expect(state.activeCustomers).toBeNull();
    expect(state.averageCustomerValue).toBeNull();
    expect(state.budget.confidence).toBe("unknown");
  });

  it("deduplicates confirmed facts case-insensitively", () => {
    const state = createCortezFixtureState();
    const first = reduceCallState(state, {
      type: "fact_added",
      category: "businessImpacts",
      value: "Eight administrative hours per week",
      occurredAt: "2026-07-29T16:34:00.000Z",
    });
    const second = reduceCallState(first, {
      type: "fact_added",
      category: "businessImpacts",
      value: "eight administrative hours per week",
      occurredAt: "2026-07-29T16:34:05.000Z",
    });

    expect(second.businessImpacts).toEqual([
      "Eight administrative hours per week",
    ]);
  });

  it("blocks a recommendation until minimum discovery is complete", () => {
    const state = createCortezFixtureState();

    expect(getMinimumDiscoveryMissing(state)).toContain(
      "Quantified business impact",
    );
    expect(canAdvanceTo(state, "recommendation")).toBe(false);
    expect(getRecommendedNextQuestion(state)).toBe(
      "How much time do those manual tasks take during a normal week?",
    );
  });

  it("records latency samples without mutating prior state", () => {
    const state = createCortezFixtureState();
    const next = reduceCallState(state, {
      type: "latency_sample_added",
      metric: "firstAudioMs",
      value: 612,
      occurredAt: "2026-07-29T16:35:00.000Z",
    });

    expect(state.metrics.firstAudioMs).toEqual([]);
    expect(next.metrics.firstAudioMs).toEqual([612]);
  });

  it("clears obsolete telemetry while preserving the persisted conversation", () => {
    const state = createCortezFixtureState();
    const legacyState = {
      ...state,
      metrics: {
        connectionMs: [2912],
        firstAudioMs: [],
        interruptionMs: [],
        audioDropouts: 0,
      },
    };

    const migrated = parsePersistedCallState(legacyState);

    expect(migrated?.transcript).toEqual(state.transcript);
    expect(migrated?.metrics).toEqual({
      telemetryVersion: METRICS_TELEMETRY_VERSION,
      connectionMs: [],
      firstAudioMs: [],
      interruptionMs: [],
      audioConcealmentEvents: 0,
      nonSilentConcealedSamples: 0,
      audioQualityObservedMs: 0,
    });
  });

  it("preserves version-two latency samples while resetting ambiguous audio quality", () => {
    const state = createCortezFixtureState();
    const versionTwoState = {
      ...state,
      metrics: {
        telemetryVersion: 2,
        connectionMs: [2760],
        firstAudioMs: [776],
        interruptionMs: [0],
        audioDropouts: 1,
        audioQualityObservedMs: 110_000,
      },
    };

    expect(parsePersistedCallState(versionTwoState)?.metrics).toEqual({
      telemetryVersion: METRICS_TELEMETRY_VERSION,
      connectionMs: [2760],
      firstAudioMs: [776],
      interruptionMs: [0],
      audioConcealmentEvents: 0,
      nonSilentConcealedSamples: 0,
      audioQualityObservedMs: 0,
    });
  });

  it("preserves telemetry collected by the current measurement version", () => {
    const state = createCortezFixtureState();
    const currentState = {
      ...state,
      metrics: {
        ...state.metrics,
        connectionMs: [1432],
      },
    };

    expect(parsePersistedCallState(currentState)?.metrics.connectionMs).toEqual(
      [1432],
    );
  });
});
