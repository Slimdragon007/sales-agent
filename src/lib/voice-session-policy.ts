export type VoiceLeaseSnapshot = {
  activeLeaseCount: number;
  dailyPaidTests: number;
  nowMs: number;
};

export type VoiceLeaseDecision =
  | { allowed: true; expiresAt: number }
  | {
      allowed: false;
      code:
        | "VOICE_SAFETY_GATE"
        | "CONCURRENT_SESSION_LIMIT"
        | "DAILY_SESSION_LIMIT";
      message: string;
      status: 403 | 429;
    };

export function evaluateBrowserVoiceLease(options: {
  safety: {
    voiceEnabled: boolean;
    platformHardSpendLimit: {
      confirmed: boolean;
      monthlyUsd: number | null;
    };
    limits: {
      maxCallMinutes: number;
      maxDailyPaidTests: number;
      maxConcurrentSessions: number;
    };
  };
  snapshot: VoiceLeaseSnapshot;
}): VoiceLeaseDecision {
  const { safety, snapshot } = options;

  if (
    !safety.voiceEnabled ||
    !safety.platformHardSpendLimit.confirmed ||
    safety.platformHardSpendLimit.monthlyUsd === null
  ) {
    return {
      allowed: false,
      code: "VOICE_SAFETY_GATE",
      message:
        "Paid voice is blocked until the project hard spend limit is confirmed.",
      status: 403,
    };
  }

  if (snapshot.activeLeaseCount >= safety.limits.maxConcurrentSessions) {
    return {
      allowed: false,
      code: "CONCURRENT_SESSION_LIMIT",
      message: "The concurrent paid-session limit has been reached.",
      status: 429,
    };
  }

  if (snapshot.dailyPaidTests >= safety.limits.maxDailyPaidTests) {
    return {
      allowed: false,
      code: "DAILY_SESSION_LIMIT",
      message: "The daily paid-test limit has been reached.",
      status: 429,
    };
  }

  return {
    allowed: true,
    expiresAt: snapshot.nowMs + safety.limits.maxCallMinutes * 60 * 1_000,
  };
}

export function isBrowserVoiceLeaseExpired(
  expiresAt: number,
  nowMs: number,
): boolean {
  return expiresAt <= nowMs;
}
