import type { VoiceSafetyScope } from "./safety-policy";

export type PhoneCallLifecycleState =
  | "reserved"
  | "create_pending"
  | "provider_unknown"
  | "provider_attached"
  | "sip_claimed"
  | "provider_active"
  | "stopping"
  | "terminal";

export type PhoneCreateFailureDisposition =
  "cancel" | "provider_unknown" | "already_terminal";

export const PROVIDER_NONTERMINAL_STATES = [
  "create_pending",
  "provider_unknown",
  "provider_attached",
  "sip_claimed",
  "provider_active",
  "stopping",
] as const satisfies readonly PhoneCallLifecycleState[];

export const SIP_CLAIMABLE_STATES = [
  "create_pending",
  "provider_unknown",
  "provider_attached",
  "provider_active",
] as const satisfies readonly PhoneCallLifecycleState[];

export function isProviderNonterminalState(
  state: PhoneCallLifecycleState | null | undefined,
): boolean {
  return (
    state !== null &&
    state !== undefined &&
    (PROVIDER_NONTERMINAL_STATES as readonly string[]).includes(state)
  );
}

export function canReleaseVoiceSession(options: {
  sessionScope: VoiceSafetyScope;
  expectedScope: VoiceSafetyScope;
  lifecycleState: PhoneCallLifecycleState | null;
}): boolean {
  if (options.sessionScope !== options.expectedScope) {
    return false;
  }

  if (options.sessionScope === "phone") {
    return options.lifecycleState === "terminal";
  }

  return true;
}

export function canCancelPhoneReservation(
  lifecycleState: PhoneCallLifecycleState | null,
): boolean {
  return lifecycleState === null || lifecycleState === "reserved";
}

export function canCancelVoiceSession(options: {
  sessionScope: VoiceSafetyScope;
  expectedScope: VoiceSafetyScope;
  lifecycleState: PhoneCallLifecycleState | null;
}): boolean {
  return (
    options.sessionScope === options.expectedScope &&
    canCancelPhoneReservation(options.lifecycleState)
  );
}

export function canClaimSipObjective(options: {
  lifecycleState: PhoneCallLifecycleState;
  claimTokenMatches: boolean;
  openAiCallIdBound: boolean;
  sessionActive: boolean;
}): boolean {
  return (
    options.sessionActive &&
    options.claimTokenMatches &&
    !options.openAiCallIdBound &&
    (SIP_CLAIMABLE_STATES as readonly string[]).includes(options.lifecycleState)
  );
}

export function dispositionPhoneCreateFailure(options: {
  providerCreateStarted: boolean;
  providerStopConfirmed: boolean;
}): PhoneCreateFailureDisposition {
  if (options.providerStopConfirmed) {
    return "already_terminal";
  }

  if (options.providerCreateStarted) {
    return "provider_unknown";
  }

  return "cancel";
}

export function countsTowardPhoneConcurrency(options: {
  status: "active" | "released" | "cancelled" | "expired";
  expiresAt: number;
  lifecycleState: PhoneCallLifecycleState | null;
  now: number;
}): boolean {
  if (options.status !== "active") {
    return false;
  }

  return (
    options.expiresAt > options.now ||
    isProviderNonterminalState(options.lifecycleState)
  );
}
