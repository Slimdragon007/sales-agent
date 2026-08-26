type PaidClientSecretSafety = {
  voiceEnabled: boolean;
  platformHardSpendLimit: {
    confirmed: boolean;
    monthlyUsd: number | null;
  };
};

export function canRequestPaidClientSecret(options: {
  userInitiated: boolean;
  safety: PaidClientSecretSafety | null;
}): boolean {
  if (!options.userInitiated || options.safety === null) {
    return false;
  }

  return (
    options.safety.voiceEnabled &&
    options.safety.platformHardSpendLimit.confirmed
  );
}

export function emergencyStopShouldRun(options: {
  localActive: boolean;
  voiceStatus:
    "offline" | "connecting" | "connected" | "speaking" | "stopped" | "error";
}): boolean {
  if (options.localActive) {
    return true;
  }

  return (
    options.voiceStatus === "connecting" ||
    options.voiceStatus === "connected" ||
    options.voiceStatus === "speaking"
  );
}

export function runEmergencyStop(options: {
  localActive: boolean;
  voiceStatus:
    "offline" | "connecting" | "connected" | "speaking" | "stopped" | "error";
  stopLocalRolePlay: () => void;
  disconnect: () => void;
}): boolean {
  if (
    !emergencyStopShouldRun({
      localActive: options.localActive,
      voiceStatus: options.voiceStatus,
    })
  ) {
    return false;
  }

  options.stopLocalRolePlay();
  options.disconnect();
  return true;
}
