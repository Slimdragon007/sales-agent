import { z } from "zod";

const phonePilotCalendarConfigSchema = z.object({
  enabled: z.boolean(),
  allowWrites: z.boolean(),
});

export const runtimeSafetyConfigSchema = z.object({
  voiceEnabled: z.boolean(),
  platformHardSpendLimit: z.object({
    confirmed: z.boolean(),
    monthlyUsd: z.number().positive().nullable(),
    confirmedAt: z.string().datetime().nullable(),
  }),
  limits: z.object({
    maxCallMinutes: z.number().int().positive().max(60),
    maxDailyPaidTests: z.number().int().positive().max(100),
    maxConcurrentSessions: z.number().int().positive().max(5),
  }),
  phonePilot: z.object({
    enabled: z.boolean(),
    maxCalls: z.number().int().positive().max(20),
    maxCallMinutes: z.number().int().positive().max(15),
    maxConcurrentCalls: z.number().int().positive().max(2),
    maxEstimatedSpendUsd: z.number().positive().max(25),
    reservedUsdPerCall: z.number().positive().max(5),
    calendar: phonePilotCalendarConfigSchema.default({
      enabled: true,
      allowWrites: true,
    }),
  }),
});

export const runtimeSafetySchema = runtimeSafetyConfigSchema.extend({
  apiKeyConfigured: z.boolean(),
  activeSessions: z.number().int().nonnegative(),
  paidTestsToday: z.number().int().nonnegative(),
  realtimeModel: z.string().min(1),
  phonePilot: z.object({
    enabled: z.boolean(),
    maxCalls: z.number().int().positive().max(20),
    maxCallMinutes: z.number().int().positive().max(15),
    maxConcurrentCalls: z.number().int().positive().max(2),
    maxEstimatedSpendUsd: z.number().positive().max(25),
    reservedUsdPerCall: z.number().positive().max(5),
    calendar: phonePilotCalendarConfigSchema.extend({
      connected: z.boolean(),
    }),
  }),
  phonePilotUsage: z.object({
    activeCalls: z.number().int().nonnegative(),
    lifetimeCalls: z.number().int().nonnegative(),
    estimatedReservedSpendUsd: z.number().nonnegative(),
  }),
});

export type RuntimeSafetyConfig = z.infer<typeof runtimeSafetyConfigSchema>;
export type RuntimeSafety = z.infer<typeof runtimeSafetySchema>;
