import { describe, expect, it } from "vitest";
import { parseRealtimeUsage } from "./realtime-usage";

describe("parseRealtimeUsage", () => {
  it("reads Agents SDK session.usage shape", () => {
    expect(
      parseRealtimeUsage({
        inputTokens: 11,
        outputTokens: 22,
        totalTokens: 33,
      }),
    ).toEqual({ inputTokens: 11, outputTokens: 22, totalTokens: 33 });
  });

  it("reads response.done usage when present", () => {
    expect(
      parseRealtimeUsage({
        type: "response.done",
        response: {
          usage: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
        },
      }),
    ).toEqual({ inputTokens: 4, outputTokens: 6, totalTokens: 10 });
  });

  it("returns null for incomplete payloads", () => {
    expect(parseRealtimeUsage(null)).toBeNull();
    expect(parseRealtimeUsage({ inputTokens: 1 })).toBeNull();
  });
});
