import { describe, expect, it } from "vitest";
import {
  evaluateVoiceSafetyReservation,
  summarizeVoiceSafetyUsage,
  type VoiceSafetyPolicy,
  type VoiceSessionRecord,
} from "./safety-policy";

const NOW = Date.UTC(2026, 6, 29, 20);

const PHONE_POLICY: VoiceSafetyPolicy = {
  maxSessionMs: 5 * 60 * 1_000,
  maxConcurrentSessions: 1,
  maxDailySessions: 5,
  maxLifetimeSessions: 5,
  maxLifetimeReservedUsdCents: 500,
  reservedUsdCentsPerSession: 100,
};

function session(
  overrides: Partial<VoiceSessionRecord> = {},
): VoiceSessionRecord {
  return {
    id: crypto.randomUUID(),
    scope: "phone",
    startedAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
    status: "active",
    reservedUsdCents: 100,
    ...overrides,
  };
}

describe("voice safety policy", () => {
  it("allows one phone call and applies the five-minute expiry", () => {
    expect(
      evaluateVoiceSafetyReservation([], "phone", PHONE_POLICY, NOW),
    ).toEqual({
      allowed: true,
      expiresAt: NOW + 5 * 60 * 1_000,
      usage: {
        activeSessions: 0,
        dailySessions: 0,
        lifetimeSessions: 0,
        reservedUsdCents: 0,
      },
    });
  });

  it("blocks a second concurrent call", () => {
    const result = evaluateVoiceSafetyReservation(
      [session()],
      "phone",
      PHONE_POLICY,
      NOW,
    );

    expect(result.allowed).toBe(false);
    expect(result.allowed ? null : result.code).toBe(
      "CONCURRENT_SESSION_LIMIT",
    );
  });

  it("frees concurrency after expiry without erasing lifetime usage", () => {
    const expired = session({
      expiresAt: NOW - 1,
      status: "active",
    });

    expect(summarizeVoiceSafetyUsage([expired], "phone", NOW)).toEqual({
      activeSessions: 0,
      dailySessions: 1,
      lifetimeSessions: 1,
      reservedUsdCents: 100,
    });
    expect(
      evaluateVoiceSafetyReservation([expired], "phone", PHONE_POLICY, NOW)
        .allowed,
    ).toBe(true);
  });

  it("keeps an expired phone slot occupied while the provider is nonterminal", () => {
    const providerActive = session({
      expiresAt: NOW - 1,
      providerNonterminal: true,
    });

    expect(
      summarizeVoiceSafetyUsage([providerActive], "phone", NOW).activeSessions,
    ).toBe(1);
    expect(
      evaluateVoiceSafetyReservation(
        [providerActive],
        "phone",
        PHONE_POLICY,
        NOW,
      ).allowed,
    ).toBe(false);
  });

  it("blocks after five lifetime pilot calls", () => {
    const completed = Array.from({ length: 5 }, (_, index) =>
      session({
        id: `completed-${index}`,
        startedAt: NOW - 24 * 60 * 60 * 1_000,
        expiresAt: NOW - 1,
        status: "released",
      }),
    );
    const result = evaluateVoiceSafetyReservation(
      completed,
      "phone",
      PHONE_POLICY,
      NOW,
    );

    expect(result.allowed).toBe(false);
    expect(result.allowed ? null : result.code).toBe("LIFETIME_SESSION_LIMIT");
  });

  it("fails closed when the next reservation would exceed five dollars", () => {
    const spendPolicy: VoiceSafetyPolicy = {
      ...PHONE_POLICY,
      maxLifetimeSessions: 10,
    };
    const priorSessions = Array.from({ length: 5 }, (_, index) =>
      session({
        id: `spend-${index}`,
        startedAt: NOW - 24 * 60 * 60 * 1_000,
        reservedUsdCents: 100,
        status: "released",
      }),
    );
    const result = evaluateVoiceSafetyReservation(
      priorSessions,
      "phone",
      spendPolicy,
      NOW,
    );

    expect(result.allowed).toBe(false);
    expect(result.allowed ? null : result.code).toBe("ESTIMATED_SPEND_LIMIT");
  });

  it("counts released carrier calls but not cancelled pre-call reservations", () => {
    const yesterday = session({
      startedAt: NOW - 24 * 60 * 60 * 1_000,
      expiresAt: NOW - 1,
      status: "released",
    });
    const failedAfterCarrierCreation = session({
      expiresAt: NOW - 1,
      status: "released",
    });
    const cancelled = session({ status: "cancelled" });

    expect(
      summarizeVoiceSafetyUsage(
        [yesterday, failedAfterCarrierCreation, cancelled],
        "phone",
        NOW,
      ),
    ).toEqual({
      activeSessions: 0,
      dailySessions: 1,
      lifetimeSessions: 2,
      reservedUsdCents: 200,
    });
  });
});
