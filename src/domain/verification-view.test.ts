import { describe, expect, it } from "vitest";
import { createCortezFixtureState } from "./call-state";
import { evaluateQualification } from "./qualification";
import { REQUIRED_ROLE_PLAY_SAMPLES } from "./latency";
import { CORTEZ_EVAL_CASES, runCortezBaseline } from "../evals/cortez";
import type { RuntimeSafety } from "../lib/runtime-safety-schema";
import { buildVerificationViewModel } from "./verification-view";

function createSafetyFixture(): RuntimeSafety {
  return {
    voiceEnabled: true,
    platformHardSpendLimit: {
      confirmed: true,
      monthlyUsd: 25,
      confirmedAt: "2026-07-29T12:00:00.000Z",
    },
    limits: {
      maxCallMinutes: 15,
      maxDailyPaidTests: 10,
      maxConcurrentSessions: 1,
    },
    phonePilot: {
      enabled: false,
      maxCalls: 5,
      maxCallMinutes: 3,
      maxConcurrentCalls: 1,
      maxEstimatedSpendUsd: 5,
      reservedUsdPerCall: 1,
      calendar: {
        enabled: false,
        allowWrites: false,
        connected: false,
      },
    },
    apiKeyConfigured: true,
    activeSessions: 0,
    paidTestsToday: 2,
    realtimeModel: "gpt-realtime-2.1",
    phonePilotUsage: {
      activeCalls: 0,
      lifetimeCalls: 0,
      estimatedReservedSpendUsd: 0,
    },
  };
}

describe("buildVerificationViewModel", () => {
  it("derives confirmed items from live prospect fixture fields", () => {
    const state = createCortezFixtureState();
    const view = buildVerificationViewModel({
      state,
      safety: null,
      voiceActive: false,
      cortezPasses: 10,
      cortezTotal: 10,
    });

    expect(view.confirmed).toEqual([
      "Owner: Alex Rivera",
      "Target: August",
      "Pain: The current workflow is manual and unstructured",
      "Current workflow confirmed",
    ]);
    expect(view.confirmed.length).toBeGreaterThan(0);
  });

  it("maps qualification label and tone from evaluateQualification", () => {
    const state = createCortezFixtureState();
    const view = buildVerificationViewModel({
      state,
      safety: null,
      voiceActive: false,
      cortezPasses: 10,
      cortezTotal: 10,
    });

    expect(view.qualificationLabel).toBe("Incomplete");
    expect(view.qualificationTone).toBe("amber");
    expect(view.qualificationLabel).not.toBe("Qualification incomplete");

    const qualifiedState = {
      ...state,
      businessImpacts: ["Eight administrative hours per week"],
      budget: {
        ...state.budget,
        minimum: 500,
        maximum: 2_000,
        confidence: "medium" as const,
      },
      scope: {
        ...state.scope,
        launch: ["Collect payment and deliver one digital program"],
      },
      missingFields: [],
    };
    const qualifiedView = buildVerificationViewModel({
      state: qualifiedState,
      safety: null,
      voiceActive: false,
      cortezPasses: 10,
      cortezTotal: 10,
    });

    expect(evaluateQualification(qualifiedState).status).toBe("qualified");
    expect(qualifiedView.qualificationLabel).toBe("Qualified");
    expect(qualifiedView.qualificationTone).toBe("green");
  });

  it("flows runtime safety usage and limits into session labels", () => {
    const safety = createSafetyFixture();
    const view = buildVerificationViewModel({
      state: createCortezFixtureState(),
      safety,
      voiceActive: true,
      cortezPasses: 10,
      cortezTotal: 10,
    });

    expect(view.maxCallLabel).toBe("15 min");
    expect(view.paidTestsLabel).toBe("2 / 10");
    expect(view.concurrentLabel).toBe("0 / 1");
    expect(view.spendLimitLabel).toBe("Confirmed ($25)");
    expect(view.spendLimitTone).toBe("pass");
    expect(view.emergencyStopLabel).toBe("Ready");
  });

  it("marks session labels unavailable when safety is null", () => {
    const view = buildVerificationViewModel({
      state: createCortezFixtureState(),
      safety: null,
      voiceActive: false,
      cortezPasses: 10,
      cortezTotal: 10,
    });

    expect(view.maxCallLabel).toBe("Unavailable");
    expect(view.paidTestsLabel).toBe("Unavailable");
    expect(view.concurrentLabel).toBe("Unavailable");
    expect(view.spendLimitLabel).toBe("Required");
    expect(view.spendLimitTone).toBe("warn");
    expect(view.emergencyStopLabel).toBe("Idle");
  });

  it("uses live prospect baseline pass counts when provided", () => {
    const baseline = runCortezBaseline();
    const view = buildVerificationViewModel({
      state: createCortezFixtureState(),
      safety: null,
      voiceActive: false,
      cortezPasses: baseline.filter((result) => result.passed).length,
      cortezTotal: CORTEZ_EVAL_CASES.length,
    });

    expect(view.cortezPasses).toBe(CORTEZ_EVAL_CASES.length);
    expect(view.cortezTotal).toBe(CORTEZ_EVAL_CASES.length);
  });

  it("reports latency sample progress from connection metrics", () => {
    const state = createCortezFixtureState();
    const withSamples = {
      ...state,
      metrics: {
        ...state.metrics,
        connectionMs: [120, 140, 160],
      },
    };
    const view = buildVerificationViewModel({
      state: withSamples,
      safety: null,
      voiceActive: false,
      cortezPasses: 10,
      cortezTotal: 10,
    });

    expect(view.latencySamples).toBe(3);
    expect(view.latencyRequired).toBe(REQUIRED_ROLE_PLAY_SAMPLES);
  });
});
