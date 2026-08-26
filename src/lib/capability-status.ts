export type CapabilityStatusView = {
  apollo: "read_only" | "disabled";
  sending: "disabled";
  pricing: "approval_required";
  phonePilot: "owner_dialer_enabled" | "outbound_locked";
  calendar: "connected" | "not_connected" | "disabled" | "unknown";
};

function resolveCalendarStatus(
  safety: {
    phonePilot: {
      calendar?: {
        enabled: boolean;
        connected?: boolean;
      };
    };
  } | null,
): CapabilityStatusView["calendar"] {
  const calendarPolicy = safety?.phonePilot.calendar;

  if (!safety || !calendarPolicy) {
    return "unknown";
  }

  if (!calendarPolicy.enabled) {
    return "disabled";
  }

  if (calendarPolicy.connected === true) {
    return "connected";
  }

  if (calendarPolicy.connected === false) {
    return "not_connected";
  }

  return "unknown";
}

export function getCapabilityStatus(
  safety: {
    phonePilot: {
      enabled: boolean;
      calendar?: {
        enabled: boolean;
        connected?: boolean;
      };
    };
  } | null,
): CapabilityStatusView {
  return {
    apollo: "read_only",
    sending: "disabled",
    pricing: "approval_required",
    phonePilot:
      safety?.phonePilot.enabled === true
        ? "owner_dialer_enabled"
        : "outbound_locked",
    calendar: resolveCalendarStatus(safety),
  };
}
