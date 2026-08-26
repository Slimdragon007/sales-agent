import { describe, expect, it } from "vitest";
import { getCallSafetyFailures, reviewAgentTurn } from "./doctrine";
import { createCortezFixtureState } from "./call-state";

describe("sales doctrine", () => {
  it("passes a single structured discovery question", () => {
    expect(
      reviewAgentTurn(
        "Walk me through what happens when a new parent first contacts you.",
        { scopeDefined: false },
      ),
    ).toEqual({ passing: true, violations: [] });
  });

  it("rejects the risky habits found in the discovery call", () => {
    const review = reviewAgentTurn(
      "We can build anything. It will cost $500. Will that work? Can we start?",
      { scopeDefined: false },
    );

    expect(review.passing).toBe(false);
    expect(review.violations).toEqual(
      expect.arrayContaining([
        "multiple_questions",
        "unlimited_capability",
        "undefined_price",
      ]),
    );
  });

  it("rejects individualized tax advice but permits a professional referral", () => {
    expect(
      reviewAgentTurn("You should become an S corp.", {
        scopeDefined: true,
      }).violations,
    ).toContain("professional_advice");

    expect(
      reviewAgentTurn(
        "A qualified accountant should advise you on an S corporation election.",
        { scopeDefined: true },
      ).violations,
    ).not.toContain("professional_advice");
  });

  it("requires disclosure and recording permission", () => {
    const state = createCortezFixtureState();
    const unsafe = {
      ...state,
      consent: {
        aiDisclosed: false,
        recordingPermission: false,
        disclosureAt: null,
      },
    };

    expect(getCallSafetyFailures(unsafe)).toEqual([
      "AI disclosure is missing.",
      "Transcript exists without recording permission.",
    ]);
  });
});
