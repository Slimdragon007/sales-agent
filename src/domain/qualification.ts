import {
  getMinimumDiscoveryMissing,
  type CallState,
  type QualificationStatus,
} from "./call-state";

export type QualificationResult = {
  status: QualificationStatus;
  score: number;
  reasoning: string[];
  missing: string[];
};

function addPoints(
  condition: boolean,
  points: number,
  reason: string,
  reasoning: string[],
): number {
  if (!condition) {
    return 0;
  }

  reasoning.push(`+${points}: ${reason}`);
  return points;
}

export function evaluateQualification(state: CallState): QualificationResult {
  const reasoning: string[] = [];
  const missing = getMinimumDiscoveryMissing(state);

  const blocked =
    state.risks.some((risk) => /no lawful basis/i.test(risk)) ||
    state.risks.some((risk) => /explicitly declined/i.test(risk));

  if (blocked) {
    return {
      status: "disqualified",
      score: 0,
      reasoning: [
        "Disqualified: a hard consent or contactability block exists.",
      ],
      missing,
    };
  }

  let score = 0;
  score += addPoints(
    state.desiredOutcomes.length > 0 &&
      state.currentWorkflow.length > 0 &&
      state.confirmedPains.length > 0,
    25,
    "Need and current workflow are confirmed",
    reasoning,
  );
  score += addPoints(
    state.businessImpacts.length > 0,
    20,
    "Business impact is confirmed",
    reasoning,
  );
  score += addPoints(
    state.authority.decisionMaker !== null,
    15,
    "Decision authority is known",
    reasoning,
  );
  score += addPoints(
    state.timeline.targetDate !== null && state.timeline.reason !== null,
    15,
    "Timing and its reason are known",
    reasoning,
  );
  score += addPoints(
    state.budget.confidence !== "unknown",
    15,
    "Investment readiness has been discussed",
    reasoning,
  );
  score += addPoints(
    state.scope.launch.length > 0,
    10,
    "Phase-one priority is clear",
    reasoning,
  );

  let status: QualificationStatus;

  if (missing.length > 0) {
    status = "incomplete";
  } else if (score >= 75) {
    status = "qualified";
  } else if (score >= 45) {
    status = "nurture";
  } else {
    status = "disqualified";
  }

  return { status, score, reasoning, missing };
}
