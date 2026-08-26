export type VoiceSafetyScope = "browser" | "phone";

export type VoiceSessionStatus =
  "active" | "released" | "cancelled" | "expired";

export type VoiceSessionRecord = {
  id: string;
  scope: VoiceSafetyScope;
  startedAt: number;
  expiresAt: number;
  status: VoiceSessionStatus;
  reservedUsdCents: number;
  providerNonterminal?: boolean;
};

export type VoiceSafetyPolicy = {
  maxSessionMs: number;
  maxConcurrentSessions: number;
  maxDailySessions: number;
  maxLifetimeSessions: number | null;
  maxLifetimeReservedUsdCents: number | null;
  reservedUsdCentsPerSession: number;
};

export type VoiceSafetyUsage = {
  activeSessions: number;
  dailySessions: number;
  lifetimeSessions: number;
  reservedUsdCents: number;
};

export type VoiceSafetyBlockCode =
  | "CONCURRENT_SESSION_LIMIT"
  | "DAILY_SESSION_LIMIT"
  | "LIFETIME_SESSION_LIMIT"
  | "ESTIMATED_SPEND_LIMIT";

export type VoiceSafetyDecision =
  | {
      allowed: true;
      expiresAt: number;
      usage: VoiceSafetyUsage;
    }
  | {
      allowed: false;
      code: VoiceSafetyBlockCode;
      message: string;
      usage: VoiceSafetyUsage;
    };

function getUtcDayStart(now: number): number {
  const date = new Date(now);

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function summarizeVoiceSafetyUsage(
  sessions: readonly VoiceSessionRecord[],
  scope: VoiceSafetyScope,
  now: number,
): VoiceSafetyUsage {
  const dayStart = getUtcDayStart(now);
  const countedSessions = sessions.filter(
    (session) => session.scope === scope && session.status !== "cancelled",
  );

  return {
    activeSessions: countedSessions.filter(
      (session) =>
        session.status === "active" &&
        (session.expiresAt > now || session.providerNonterminal === true),
    ).length,
    dailySessions: countedSessions.filter(
      (session) => session.startedAt >= dayStart,
    ).length,
    lifetimeSessions: countedSessions.length,
    reservedUsdCents: countedSessions.reduce(
      (total, session) => total + session.reservedUsdCents,
      0,
    ),
  };
}

export function evaluateVoiceSafetyReservation(
  sessions: readonly VoiceSessionRecord[],
  scope: VoiceSafetyScope,
  policy: VoiceSafetyPolicy,
  now: number,
): VoiceSafetyDecision {
  const usage = summarizeVoiceSafetyUsage(sessions, scope, now);

  if (usage.activeSessions >= policy.maxConcurrentSessions) {
    return {
      allowed: false,
      code: "CONCURRENT_SESSION_LIMIT",
      message: "The concurrent paid-session limit has been reached.",
      usage,
    };
  }

  if (usage.dailySessions >= policy.maxDailySessions) {
    return {
      allowed: false,
      code: "DAILY_SESSION_LIMIT",
      message: "The daily paid-session limit has been reached.",
      usage,
    };
  }

  if (
    policy.maxLifetimeSessions !== null &&
    usage.lifetimeSessions >= policy.maxLifetimeSessions
  ) {
    return {
      allowed: false,
      code: "LIFETIME_SESSION_LIMIT",
      message: "The lifetime phone-pilot call limit has been reached.",
      usage,
    };
  }

  if (
    policy.maxLifetimeReservedUsdCents !== null &&
    usage.reservedUsdCents + policy.reservedUsdCentsPerSession >
      policy.maxLifetimeReservedUsdCents
  ) {
    return {
      allowed: false,
      code: "ESTIMATED_SPEND_LIMIT",
      message: "The phone pilot's estimated spend limit has been reached.",
      usage,
    };
  }

  return {
    allowed: true,
    expiresAt: now + policy.maxSessionMs,
    usage,
  };
}
