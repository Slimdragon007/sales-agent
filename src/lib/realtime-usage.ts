import { z } from "zod";

export type RealtimeUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const sessionUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

const responseDoneUsageSchema = z.object({
  type: z.literal("response.done"),
  response: z.object({
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      total_tokens: z.number(),
    }),
  }),
});

export function parseRealtimeUsage(source: unknown): RealtimeUsage | null {
  const sessionResult = sessionUsageSchema.safeParse(source);
  if (sessionResult.success) {
    return sessionResult.data;
  }

  const responseDoneResult = responseDoneUsageSchema.safeParse(source);
  if (responseDoneResult.success) {
    const { usage } = responseDoneResult.data.response;
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
    };
  }

  return null;
}
