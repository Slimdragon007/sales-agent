import { describe, expect, it } from "vitest";
import { DISCOVERY_STAGES, getStage, getStageNumber } from "./stages";

describe("discovery stages", () => {
  it("keeps the approved twelve-stage sequence", () => {
    expect(DISCOVERY_STAGES).toHaveLength(12);
    expect(DISCOVERY_STAGES[0]?.id).toBe("disclosure_permission");
    expect(DISCOVERY_STAGES[3]?.id).toBe("current_workflow");
    expect(DISCOVERY_STAGES[11]?.id).toBe("mutual_action_plan");
  });

  it("returns one-based stage numbers and labels", () => {
    expect(getStageNumber("current_workflow")).toBe(4);
    expect(getStage("current_workflow").label).toBe("Current workflow");
  });
});
