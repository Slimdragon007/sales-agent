import { describe, expect, it } from "vitest";
import {
  evaluateBrowserVoiceLease,
  isBrowserVoiceLeaseExpired,
} from "./voice-session-policy";

const baseSafety = {
  voiceEnabled: true,
  platformHardSpendLimit: { confirmed: true, monthlyUsd: 10 },
  limits: {
    maxCallMinutes: 15,
    maxDailyPaidTests: 10,
    maxConcurrentSessions: 1,
  },
};

describe("evaluateBrowserVoiceLease", () => {
  it("blocks when the platform hard spend limit is unconfirmed", () => {
    const decision = evaluateBrowserVoiceLease({
      safety: {
        ...baseSafety,
        platformHardSpendLimit: { confirmed: false, monthlyUsd: null },
      },
      snapshot: { activeLeaseCount: 0, dailyPaidTests: 0, nowMs: 0 },
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "VOICE_SAFETY_GATE",
      status: 403,
    });
  });

  it("blocks concurrent and daily paid-test overflow", () => {
    expect(
      evaluateBrowserVoiceLease({
        safety: baseSafety,
        snapshot: { activeLeaseCount: 1, dailyPaidTests: 0, nowMs: 0 },
      }),
    ).toMatchObject({ code: "CONCURRENT_SESSION_LIMIT", status: 429 });

    expect(
      evaluateBrowserVoiceLease({
        safety: baseSafety,
        snapshot: { activeLeaseCount: 0, dailyPaidTests: 10, nowMs: 0 },
      }),
    ).toMatchObject({ code: "DAILY_SESSION_LIMIT", status: 429 });
  });

  it("allows a session and sets fifteen-minute expiry", () => {
    const nowMs = 1_000_000;
    const decision = evaluateBrowserVoiceLease({
      safety: baseSafety,
      snapshot: { activeLeaseCount: 0, dailyPaidTests: 0, nowMs },
    });
    expect(decision).toEqual({
      allowed: true,
      expiresAt: nowMs + 15 * 60 * 1_000,
    });
  });
});

describe("isBrowserVoiceLeaseExpired", () => {
  it("uses fake-clock comparison for the fifteen-minute gate", () => {
    expect(isBrowserVoiceLeaseExpired(100, 100)).toBe(true);
    expect(isBrowserVoiceLeaseExpired(101, 100)).toBe(false);
  });
});
