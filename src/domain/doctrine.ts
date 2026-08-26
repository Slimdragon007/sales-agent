import type { CallState } from "./call-state";

export type DoctrineViolation =
  | "multiple_questions"
  | "unlimited_capability"
  | "undefined_price"
  | "revenue_guarantee"
  | "professional_advice"
  | "human_impersonation";

export type DoctrineReview = {
  passing: boolean;
  violations: DoctrineViolation[];
};

const unlimitedCapabilityPatterns = [
  /\bcan build anything\b/i,
  /\bcan do whatever you need\b/i,
  /\bwe can do all of it\b/i,
];

const pricePatterns = [
  /\$\s?\d[\d,]*(?:\.\d+)?/,
  /\bthe price is\b/i,
  /\bit will cost\b/i,
];

const revenueGuaranteePatterns = [
  /\bguarantee(?:d)? revenue\b/i,
  /\bwill (?:double|triple|quadruple) your\b/i,
  /\bguarantee(?:d)? leads?\b/i,
];

const professionalAdvicePatterns = [
  /\byou should (?:form|become|elect) an? s corp/i,
  /\byour tax rate (?:is|will be)\b/i,
  /\byou need umbrella insurance\b/i,
];

const humanImpersonationPatterns = [
  /\bi am a human\b/i,
  /\bi'?m not an ai\b/i,
  /\bthis is (?:the )?(?:operator|owner) speaking\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

export function reviewAgentTurn(
  text: string,
  options: { scopeDefined: boolean },
): DoctrineReview {
  const violations: DoctrineViolation[] = [];

  if (countQuestions(text) > 1) {
    violations.push("multiple_questions");
  }
  if (matchesAny(text, unlimitedCapabilityPatterns)) {
    violations.push("unlimited_capability");
  }
  if (!options.scopeDefined && matchesAny(text, pricePatterns)) {
    violations.push("undefined_price");
  }
  if (matchesAny(text, revenueGuaranteePatterns)) {
    violations.push("revenue_guarantee");
  }

  const defersToProfessional =
    /\b(?:tax|legal|insurance) professional\b/i.test(text) ||
    /\bqualified (?:accountant|attorney|advisor)\b/i.test(text);

  if (!defersToProfessional && matchesAny(text, professionalAdvicePatterns)) {
    violations.push("professional_advice");
  }
  if (matchesAny(text, humanImpersonationPatterns)) {
    violations.push("human_impersonation");
  }

  return {
    passing: violations.length === 0,
    violations,
  };
}

export function getCallSafetyFailures(state: CallState): string[] {
  const failures: string[] = [];

  if (!state.consent.aiDisclosed) {
    failures.push("AI disclosure is missing.");
  }
  if (!state.consent.recordingPermission && state.transcript.length > 0) {
    failures.push("Transcript exists without recording permission.");
  }
  if (state.mode !== "local_simulation" && state.prospect.source.length === 0) {
    failures.push("Lead source is missing.");
  }

  return failures;
}
