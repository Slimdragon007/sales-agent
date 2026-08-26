import { describe, expect, it } from "vitest";
import { CORTEZ_EVAL_CASES, runCortezBaseline, runCortezEval } from "./cortez";

describe("prospect behavioral evaluations", () => {
  it("contains the ten approved scenarios", () => {
    expect(CORTEZ_EVAL_CASES).toHaveLength(10);
  });

  it("passes every reviewed baseline response", () => {
    const results = runCortezBaseline();

    expect(
      results.filter((result) => !result.passed).map((result) => result),
    ).toEqual([]);
  });

  it("catches an immediate app pitch after “I need structure”", () => {
    const result = runCortezEval(
      "needs_structure",
      "Great, we can build you an app right away.",
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "Current workflow was not explored.",
        "An application was pitched too early.",
      ]),
    );
  });

  it("catches a vague close without a mutual action plan", () => {
    const result = runCortezEval(
      "mutual_action_plan",
      "Sounds good. I’ll follow up soon.",
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "Prospect responsibility is missing.",
        "A scheduled review is missing.",
        "Decision purpose is missing.",
      ]),
    );
  });
});
