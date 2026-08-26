import { describe, expect, it } from "vitest";
import { createCortezFixtureState } from "./call-state";
import { evaluateQualification } from "./qualification";

describe("qualification", () => {
  it("keeps the prospect incomplete while impact and launch priority are missing", () => {
    const result = evaluateQualification(createCortezFixtureState());

    expect(result.status).toBe("incomplete");
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "Quantified business impact",
        "Phase-one priority",
      ]),
    );
    expect(result.reasoning.every((reason) => reason.startsWith("+"))).toBe(
      true,
    );
  });

  it("uses only explicit evidence for a qualified result", () => {
    const fixture = createCortezFixtureState();
    const complete = {
      ...fixture,
      businessImpacts: ["Eight administrative hours per week"],
      budget: {
        ...fixture.budget,
        minimum: 500,
        maximum: 2_000,
        confidence: "medium" as const,
      },
      scope: {
        ...fixture.scope,
        launch: ["Collect payment and deliver one digital program"],
      },
    };
    const result = evaluateQualification(complete);

    expect(result.status).toBe("qualified");
    expect(result.score).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it("hard-disqualifies a consent block", () => {
    const fixture = createCortezFixtureState();
    const result = evaluateQualification({
      ...fixture,
      risks: [...fixture.risks, "No lawful basis to contact this person"],
    });

    expect(result.status).toBe("disqualified");
    expect(result.score).toBe(0);
  });
});
