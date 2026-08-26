import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openAIRealtimeClientSecretSchema,
  PREVIEW_REQUEST_INTENT_HEADER,
  PREVIEW_REQUEST_INTENT_VALUE,
} from "./realtime-config";
import {
  createRealtimeLease,
  realtimeLeaseSchema,
  runtimeSafetySchema,
} from "./runtime-safety";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runtime safety contracts", () => {
  it("accepts a locked offline runtime", () => {
    expect(
      runtimeSafetySchema.parse({
        voiceEnabled: false,
        platformHardSpendLimit: {
          confirmed: false,
          monthlyUsd: null,
          confirmedAt: null,
        },
        limits: {
          maxCallMinutes: 15,
          maxDailyPaidTests: 10,
          maxConcurrentSessions: 1,
        },
        phonePilot: {
          enabled: false,
          maxCalls: 5,
          maxCallMinutes: 3,
          maxConcurrentCalls: 1,
          maxEstimatedSpendUsd: 5,
          reservedUsdPerCall: 1,
          calendar: {
            enabled: false,
            allowWrites: false,
            connected: false,
          },
        },
        apiKeyConfigured: true,
        activeSessions: 0,
        paidTestsToday: 0,
        realtimeModel: "gpt-realtime-2.1",
        phonePilotUsage: {
          activeCalls: 0,
          lifetimeCalls: 0,
          estimatedReservedSpendUsd: 0,
        },
      }).voiceEnabled,
    ).toBe(false);
  });

  it("preserves Worker Google Calendar connection state", () => {
    const parsed = runtimeSafetySchema.parse({
      voiceEnabled: true,
      platformHardSpendLimit: {
        confirmed: true,
        monthlyUsd: 10,
        confirmedAt: "2026-07-30T06:26:00.000Z",
      },
      limits: {
        maxCallMinutes: 15,
        maxDailyPaidTests: 10,
        maxConcurrentSessions: 1,
      },
      phonePilot: {
        enabled: true,
        maxCalls: 5,
        maxCallMinutes: 5,
        maxConcurrentCalls: 1,
        maxEstimatedSpendUsd: 5,
        reservedUsdPerCall: 1,
        calendar: {
          enabled: true,
          allowWrites: true,
          connected: true,
        },
      },
      apiKeyConfigured: true,
      activeSessions: 0,
      paidTestsToday: 0,
      realtimeModel: "gpt-realtime-2.1",
      phonePilotUsage: {
        activeCalls: 0,
        lifetimeCalls: 0,
        estimatedReservedSpendUsd: 0,
      },
    });

    expect(parsed.phonePilot.calendar.connected).toBe(true);
  });

  it("extracts only an ephemeral client secret", () => {
    const parsed = realtimeLeaseSchema.parse({
      leaseId: "4fd0fa4d-2ad0-4d55-a099-07175c734cd4",
      expiresAt: 1_800_000_000_000,
      clientSecret: "ek_test_value",
    });

    expect(parsed.clientSecret).toBe("ek_test_value");
  });

  it("accepts the current GA top-level OpenAI client-secret response", () => {
    const parsed = openAIRealtimeClientSecretSchema.parse({
      value: "ek_test_value",
      expires_at: 1_800_000_000,
      session: { type: "realtime" },
    });

    expect(parsed.value).toBe("ek_test_value");
  });

  it("marks paid lease requests as coming from the owner interface", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        leaseId: "4fd0fa4d-2ad0-4d55-a099-07175c734cd4",
        expiresAt: 1_800_000_000_000,
        clientSecret: "ek_test_value",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createRealtimeLease();

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];

    expect(call?.[0]).toBe("/api/realtime/client-secret");
    expect(call?.[1]?.method).toBe("POST");
    expect(
      new Headers(call?.[1]?.headers).get(PREVIEW_REQUEST_INTENT_HEADER),
    ).toBe(PREVIEW_REQUEST_INTENT_VALUE);
  });
});
