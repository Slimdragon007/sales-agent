import { describe, expect, it } from "vitest";
import { callModeSchema } from "./call-state";

describe("callModeSchema", () => {
  it("accepts only warm, referred, inbound, consented, or local simulation modes", () => {
    for (const mode of [
      "local_simulation",
      "warm_referral",
      "inbound",
      "consented_outbound",
    ] as const) {
      expect(callModeSchema.parse(mode)).toBe(mode);
    }
  });

  it("rejects cold outbound and unknown modes", () => {
    for (const mode of ["cold_outbound", "apollo_sequence", "", "production"]) {
      expect(callModeSchema.safeParse(mode).success).toBe(false);
    }
  });
});
