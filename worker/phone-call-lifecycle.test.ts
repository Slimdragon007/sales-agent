import { describe, expect, it } from "vitest";
import {
  canCancelPhoneReservation,
  canCancelVoiceSession,
  canClaimSipObjective,
  canReleaseVoiceSession,
  countsTowardPhoneConcurrency,
  dispositionPhoneCreateFailure,
  isProviderNonterminalState,
  PROVIDER_NONTERMINAL_STATES,
} from "./phone-call-lifecycle";
import {
  evaluateVoiceSafetyReservation,
  type VoiceSafetyPolicy,
  type VoiceSessionRecord,
} from "./safety-policy";

const NOW = 1_700_000_000_000;

const PHONE_POLICY: VoiceSafetyPolicy = {
  maxSessionMs: 5 * 60 * 1_000,
  maxConcurrentSessions: 1,
  maxDailySessions: 5,
  maxLifetimeSessions: 5,
  maxLifetimeReservedUsdCents: 500,
  reservedUsdCentsPerSession: 100,
};

function phoneSession(
  overrides: Partial<VoiceSessionRecord> = {},
): VoiceSessionRecord {
  return {
    id: "lease-1",
    scope: "phone",
    startedAt: NOW - 60_000,
    expiresAt: NOW + 240_000,
    status: "active",
    reservedUsdCents: 100,
    ...overrides,
  };
}

describe("phone call lifecycle policy", () => {
  it("treats every nonterminal provider state as concurrency-blocking", () => {
    for (const state of PROVIDER_NONTERMINAL_STATES) {
      expect(isProviderNonterminalState(state)).toBe(true);
      expect(
        countsTowardPhoneConcurrency({
          status: "active",
          expiresAt: NOW - 1,
          lifecycleState: state,
          now: NOW,
        }),
      ).toBe(true);
    }

    expect(isProviderNonterminalState("terminal")).toBe(false);
    expect(isProviderNonterminalState("reserved")).toBe(false);
    expect(
      countsTowardPhoneConcurrency({
        status: "active",
        expiresAt: NOW - 1,
        lifecycleState: "terminal",
        now: NOW,
      }),
    ).toBe(false);
  });

  it("blocks another reservation while an expired lease remains provider-nonterminal", () => {
    const sessions = [
      phoneSession({
        expiresAt: NOW - 1,
        providerNonterminal: true,
      }),
    ];

    expect(
      evaluateVoiceSafetyReservation(sessions, "phone", PHONE_POLICY, NOW)
        .allowed,
    ).toBe(false);
  });

  it("frees concurrency after a verified terminal transition", () => {
    const sessions = [
      phoneSession({
        status: "released",
        expiresAt: NOW - 1,
        providerNonterminal: false,
      }),
    ];

    expect(
      evaluateVoiceSafetyReservation(sessions, "phone", PHONE_POLICY, NOW)
        .allowed,
    ).toBe(true);
  });

  it("rejects browser release of a phone lease and requires a terminal phone state", () => {
    expect(
      canReleaseVoiceSession({
        sessionScope: "phone",
        expectedScope: "browser",
        lifecycleState: "provider_active",
      }),
    ).toBe(false);
    expect(
      canReleaseVoiceSession({
        sessionScope: "phone",
        expectedScope: "phone",
        lifecycleState: "provider_unknown",
      }),
    ).toBe(false);
    expect(
      canReleaseVoiceSession({
        sessionScope: "phone",
        expectedScope: "phone",
        lifecycleState: "terminal",
      }),
    ).toBe(true);
    expect(
      canReleaseVoiceSession({
        sessionScope: "browser",
        expectedScope: "browser",
        lifecycleState: null,
      }),
    ).toBe(true);
  });

  it("only cancels reservations that never left the reserved state", () => {
    expect(canCancelPhoneReservation(null)).toBe(true);
    expect(canCancelPhoneReservation("reserved")).toBe(true);
    expect(canCancelPhoneReservation("create_pending")).toBe(false);
    expect(canCancelPhoneReservation("provider_unknown")).toBe(false);
  });

  it("refuses to cancel a lease belonging to another scope", () => {
    expect(
      canCancelVoiceSession({
        sessionScope: "phone",
        expectedScope: "browser",
        lifecycleState: "reserved",
      }),
    ).toBe(false);
    expect(
      canCancelVoiceSession({
        sessionScope: "phone",
        expectedScope: "phone",
        lifecycleState: "reserved",
      }),
    ).toBe(true);
    expect(
      canCancelVoiceSession({
        sessionScope: "phone",
        expectedScope: "phone",
        lifecycleState: "create_pending",
      }),
    ).toBe(false);
    expect(
      canCancelVoiceSession({
        sessionScope: "browser",
        expectedScope: "browser",
        lifecycleState: null,
      }),
    ).toBe(true);
  });

  it("requires an unconsumed claim token and active session for SIP claim", () => {
    expect(
      canClaimSipObjective({
        lifecycleState: "provider_attached",
        claimTokenMatches: true,
        openAiCallIdBound: false,
        sessionActive: true,
      }),
    ).toBe(true);
    expect(
      canClaimSipObjective({
        lifecycleState: "provider_attached",
        claimTokenMatches: false,
        openAiCallIdBound: false,
        sessionActive: true,
      }),
    ).toBe(false);
    expect(
      canClaimSipObjective({
        lifecycleState: "provider_attached",
        claimTokenMatches: true,
        openAiCallIdBound: true,
        sessionActive: true,
      }),
    ).toBe(false);
    expect(
      canClaimSipObjective({
        lifecycleState: "sip_claimed",
        claimTokenMatches: true,
        openAiCallIdBound: false,
        sessionActive: true,
      }),
    ).toBe(false);
    expect(
      canClaimSipObjective({
        lifecycleState: "reserved",
        claimTokenMatches: true,
        openAiCallIdBound: false,
        sessionActive: true,
      }),
    ).toBe(false);
  });

  it("keeps ambiguous provider creation counted and cancels only pre-create failures", () => {
    expect(
      dispositionPhoneCreateFailure({
        providerCreateStarted: false,
        providerStopConfirmed: false,
      }),
    ).toBe("cancel");
    expect(
      dispositionPhoneCreateFailure({
        providerCreateStarted: true,
        providerStopConfirmed: false,
      }),
    ).toBe("provider_unknown");
    expect(
      dispositionPhoneCreateFailure({
        providerCreateStarted: true,
        providerStopConfirmed: true,
      }),
    ).toBe("already_terminal");
  });
});
