import type { RuntimeSafety } from "../lib/runtime-safety-schema";
import type { CallState } from "./call-state";
import { getRecommendedNextQuestion } from "./call-state";
import { REQUIRED_ROLE_PLAY_SAMPLES } from "./latency";
import { evaluateQualification } from "./qualification";

export type VerificationViewModel = {
  qualificationLabel: string;
  qualificationTone: "amber" | "green" | "red";
  confirmed: string[];
  missing: string[];
  risk: string;
  recommendedQuestion: string;
  cortezPasses: number;
  cortezTotal: number;
  latencySamples: number;
  latencyRequired: number;
  maxCallLabel: string;
  paidTestsLabel: string;
  concurrentLabel: string;
  spendLimitLabel: string;
  spendLimitTone: "warn" | "pass";
  emergencyStopLabel: "Ready" | "Idle";
};

function toTitleCaseStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function qualificationToneFor(
  status: ReturnType<typeof evaluateQualification>["status"],
): VerificationViewModel["qualificationTone"] {
  switch (status) {
    case "incomplete":
      return "amber";
    case "qualified":
      return "green";
    case "nurture":
      return "amber";
    case "disqualified":
      return "red";
  }
}

function buildConfirmedList(state: CallState): string[] {
  const confirmed: string[] = [];

  if (state.authority.decisionMaker) {
    const { name, role } = state.authority.decisionMaker;
    confirmed.push(role ? `${role}: ${name}` : `Decision-maker: ${name}`);
  }

  if (state.timeline.targetDate) {
    confirmed.push(`Target: ${state.timeline.targetDate}`);
  }

  if (state.confirmedPains.length > 0) {
    confirmed.push(`Pain: ${state.confirmedPains[0]}`);
  }

  if (state.currentWorkflow.length > 0) {
    confirmed.push("Current workflow confirmed");
  }

  return confirmed;
}

export function buildVerificationViewModel(options: {
  state: CallState;
  safety: RuntimeSafety | null;
  voiceActive: boolean;
  cortezPasses: number;
  cortezTotal: number;
}): VerificationViewModel {
  const { state, safety, voiceActive, cortezPasses, cortezTotal } = options;
  const qualification = evaluateQualification(state);
  const spendConfirmed =
    safety?.platformHardSpendLimit.confirmed === true &&
    safety.platformHardSpendLimit.monthlyUsd !== null;

  return {
    qualificationLabel: toTitleCaseStatus(qualification.status),
    qualificationTone: qualificationToneFor(qualification.status),
    confirmed: buildConfirmedList(state),
    missing: state.missingFields,
    risk: state.risks[0] ?? "No active risk recorded",
    recommendedQuestion: getRecommendedNextQuestion(state),
    cortezPasses,
    cortezTotal,
    latencySamples: Math.min(
      state.metrics.connectionMs.length,
      REQUIRED_ROLE_PLAY_SAMPLES,
    ),
    latencyRequired: REQUIRED_ROLE_PLAY_SAMPLES,
    maxCallLabel: safety
      ? `${safety.limits.maxCallMinutes} min`
      : "Unavailable",
    paidTestsLabel: safety
      ? `${safety.paidTestsToday} / ${safety.limits.maxDailyPaidTests}`
      : "Unavailable",
    concurrentLabel: safety
      ? `${safety.activeSessions} / ${safety.limits.maxConcurrentSessions}`
      : "Unavailable",
    spendLimitLabel:
      spendConfirmed && safety
        ? `Confirmed ($${safety.platformHardSpendLimit.monthlyUsd})`
        : "Required",
    spendLimitTone: spendConfirmed ? "pass" : "warn",
    emergencyStopLabel: voiceActive ? "Ready" : "Idle",
  };
}
