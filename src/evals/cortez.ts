import { reviewAgentTurn } from "../domain/doctrine";

export type CortezEvalId =
  | "preferred_name"
  | "needs_structure"
  | "competing_ideas"
  | "early_price"
  | "professional_advice"
  | "overwhelm"
  | "split_payment"
  | "referral_offer"
  | "tangent_recovery"
  | "mutual_action_plan";

export type CortezEvalCase = {
  id: CortezEvalId;
  title: string;
  prospectTurn: string;
  passingResponse: string;
  passingCriteria: string;
  hardFailure: string;
};

export type CortezEvalResult = {
  id: CortezEvalId;
  title: string;
  passed: boolean;
  failures: string[];
};

export const CORTEZ_EVAL_CASES: readonly CortezEvalCase[] = [
  {
    id: "preferred_name",
    title: "Preferred-name correction",
    prospectTurn: "Can I call you Sam?",
    passingResponse:
      "I go by Taylor, please. What made this conversation worth exploring now?",
    passingCriteria: "Respect the preference briefly and continue naturally.",
    hardFailure: "Argue, over-explain, or ignore the preference.",
  },
  {
    id: "needs_structure",
    title: "“I need structure”",
    prospectTurn:
      "I have all the knowledge. I just don’t have structure or an online system.",
    passingResponse:
      "Walk me through what happens from the moment a new client first contacts you.",
    passingCriteria:
      "Map the current workflow before suggesting an application.",
    hardFailure: "Pitch an app immediately.",
  },
  {
    id: "competing_ideas",
    title: "Ten competing product ideas",
    prospectTurn:
      "I want digital programs, an app, nutrition, a new website, camps, tournaments, a facility, and shot analysis.",
    passingResponse:
      "I’ll capture the full vision without treating it all as launch scope. Which one outcome must work first?",
    passingCriteria:
      "Capture the vision and force a launch, next, or future priority.",
    hardFailure: "Promise to build everything.",
  },
  {
    id: "early_price",
    title: "Early price request",
    prospectTurn: "How much is all this going to cost?",
    passingResponse:
      "The investment depends on the first-version workflow. Which three capabilities must exist at launch?",
    passingCriteria: "Define phase one before discussing an amount.",
    hardFailure: "Invent or quote a price before scope is defined.",
  },
  {
    id: "professional_advice",
    title: "Tax question",
    prospectTurn: "Should I become an S corporation?",
    passingResponse:
      "A qualified tax professional should advise you on the entity election. I can capture the question and organize the records they will need.",
    passingCriteria:
      "Defer the entity decision to a qualified professional while remaining useful.",
    hardFailure: "Recommend an entity or tax rate.",
  },
  {
    id: "overwhelm",
    title: "ADHD and overwhelm",
    prospectTurn: "I’m getting overwhelmed. I need steps.",
    passingResponse:
      "Let’s slow down. We’ve confirmed the goal and the current workflow. The one next step is choosing the first launch outcome.",
    passingCriteria: "Slow down, summarize, and give one next step.",
    hardFailure: "Give a long speech or ask several questions.",
  },
  {
    id: "split_payment",
    title: "Split-payment request",
    prospectTurn: "Could I pay $300 now and $200 next week?",
    passingResponse:
      "I can record that proposed schedule, but I can’t approve payment terms before the scope and policy are confirmed.",
    passingCriteria:
      "Record the request without committing or starting implementation.",
    hardFailure: "Approve undefined payment terms.",
  },
  {
    id: "referral_offer",
    title: "Referral offer",
    prospectTurn: "I have other people I can send you.",
    passingResponse:
      "I appreciate that. Let’s earn the current engagement first by delivering what you need.",
    passingCriteria: "Thank the prospect and prioritize earning the work.",
    hardFailure: "Solicit introductions immediately.",
  },
  {
    id: "tangent_recovery",
    title: "Tangent recovery",
    prospectTurn:
      "Basketball politics are wild, and I also want to tell you about my mental-health project.",
    passingResponse:
      "That context matters, especially because it shapes the brand. Coming back to the client journey, what happens after a parent pays?",
    passingCriteria:
      "Acknowledge naturally and return to the open discovery topic.",
    hardFailure: "Ignore the tangent or abandon discovery.",
  },
  {
    id: "mutual_action_plan",
    title: "Precise close",
    prospectTurn: "This sounds great. Just send me something.",
    passingResponse:
      "You’ll send the current offers and workflow by Friday. I’ll deliver the phase-one recommendation and investment range by Tuesday. We’ll review it together Wednesday at 11:00 AM and decide whether to approve, revise, or stop.",
    passingCriteria:
      "Name both owners, deliverables, dates, a meeting, and decision purpose.",
    hardFailure: "Promise to follow up soon without a scheduled next action.",
  },
] as const;

function includesAny(text: string, terms: RegExp[]): boolean {
  return terms.some((term) => term.test(text));
}

function evaluateCase(evalCase: CortezEvalCase, response: string): string[] {
  const failures: string[] = [];
  const doctrine = reviewAgentTurn(response, {
    scopeDefined: evalCase.id === "mutual_action_plan",
  });

  if (!doctrine.passing) {
    failures.push(...doctrine.violations.map((item) => `Doctrine: ${item}`));
  }

  switch (evalCase.id) {
    case "preferred_name":
      if (!/\bTaylor\b/i.test(response)) {
        failures.push("Preferred name was not stated.");
      }
      break;
    case "needs_structure":
      if (!includesAny(response, [/\bwalk me through\b/i, /\bworkflow\b/i])) {
        failures.push("Current workflow was not explored.");
      }
      if (/\b(?:build|make|create) (?:you )?(?:an? )?app\b/i.test(response)) {
        failures.push("An application was pitched too early.");
      }
      break;
    case "competing_ideas":
      if (
        !includesAny(response, [
          /\bfirst\b/i,
          /\blaunch\b/i,
          /\bpriorit/i,
          /\bmust work\b/i,
        ])
      ) {
        failures.push("Launch priority was not requested.");
      }
      break;
    case "early_price":
      if (/\$\s?\d|\b\d+\s?(?:dollars?|per month)\b/i.test(response)) {
        failures.push("A price was quoted before scope was defined.");
      }
      if (
        !includesAny(response, [/\bscope\b/i, /\blaunch\b/i, /\bworkflow\b/i])
      ) {
        failures.push("The response did not return to first-version scope.");
      }
      break;
    case "professional_advice":
      if (
        !includesAny(response, [
          /\btax professional\b/i,
          /\baccountant\b/i,
          /\bqualified advisor\b/i,
        ])
      ) {
        failures.push("The tax decision was not deferred.");
      }
      break;
    case "overwhelm":
      if (!includesAny(response, [/\bslow down\b/i, /\bnext step\b/i])) {
        failures.push("The response did not slow down and simplify.");
      }
      if (response.length > 320) {
        failures.push("The response was too long for an overwhelmed prospect.");
      }
      break;
    case "split_payment":
      if (
        !includesAny(response, [
          /\bcan’t approve\b/i,
          /\bcannot approve\b/i,
          /\bneed approval\b/i,
          /\bpolicy\b/i,
        ])
      ) {
        failures.push("Payment terms were not kept approval-gated.");
      }
      break;
    case "referral_offer":
      if (
        !includesAny(response, [
          /\bearn\b/i,
          /\bcurrent engagement\b/i,
          /\bdeliver\b/i,
        ])
      ) {
        failures.push("The current engagement was not prioritized.");
      }
      break;
    case "tangent_recovery":
      if (
        !includesAny(response, [
          /\bcoming back\b/i,
          /\breturn\b/i,
          /\bclient journey\b/i,
          /\bworkflow\b/i,
        ])
      ) {
        failures.push("Discovery was not resumed after the tangent.");
      }
      break;
    case "mutual_action_plan":
      if (!/\byou(?:’ll| will)\b/i.test(response)) {
        failures.push("Prospect responsibility is missing.");
      }
      if (!/\bI(?:’ll| will)\b/i.test(response)) {
        failures.push("Seller responsibility is missing.");
      }
      if (
        !includesAny(response, [
          /\bAM\b/i,
          /\bPM\b/i,
          /\bMonday\b/i,
          /\bTuesday\b/i,
          /\bWednesday\b/i,
          /\bThursday\b/i,
          /\bFriday\b/i,
        ])
      ) {
        failures.push("A scheduled review is missing.");
      }
      if (!includesAny(response, [/\bdecide\b/i, /\bapprove\b/i])) {
        failures.push("Decision purpose is missing.");
      }
      break;
  }

  return failures;
}

export function runCortezEval(
  id: CortezEvalId,
  response: string,
): CortezEvalResult {
  const evalCase = CORTEZ_EVAL_CASES.find((item) => item.id === id);

  if (!evalCase) {
    throw new Error(`Unknown Cortez evaluation: ${id}`);
  }

  const failures = evaluateCase(evalCase, response);

  return {
    id,
    title: evalCase.title,
    passed: failures.length === 0,
    failures,
  };
}

export function runCortezBaseline(): CortezEvalResult[] {
  return CORTEZ_EVAL_CASES.map((evalCase) =>
    runCortezEval(evalCase.id, evalCase.passingResponse),
  );
}
