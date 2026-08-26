import { describe, expect, it } from "vitest";
import { getCapabilityStatus } from "./capability-status";

describe("getCapabilityStatus", () => {
  it("keeps Apollo, sending, and pricing non-mutating", () => {
    const status = getCapabilityStatus({
      phonePilot: {
        enabled: true,
        calendar: { enabled: true, connected: true },
      },
    });
    expect(status.apollo).toBe("read_only");
    expect(status.sending).toBe("disabled");
    expect(status.pricing).toBe("approval_required");
    expect(status.phonePilot).toBe("owner_dialer_enabled");
    expect(status.calendar).toBe("connected");
  });

  it("locks phone when pilot disabled or safety unknown", () => {
    expect(
      getCapabilityStatus({
        phonePilot: {
          enabled: false,
          calendar: { enabled: false, connected: false },
        },
      }).phonePilot,
    ).toBe("outbound_locked");
    expect(getCapabilityStatus(null).phonePilot).toBe("outbound_locked");
    expect(getCapabilityStatus(null).calendar).toBe("unknown");
  });

  it("reports Google Calendar connection honestly", () => {
    expect(
      getCapabilityStatus({
        phonePilot: {
          enabled: true,
          calendar: { enabled: true, connected: false },
        },
      }).calendar,
    ).toBe("not_connected");

    expect(
      getCapabilityStatus({
        phonePilot: {
          enabled: true,
          calendar: { enabled: false, connected: false },
        },
      }).calendar,
    ).toBe("disabled");

    expect(
      getCapabilityStatus({
        phonePilot: {
          enabled: true,
          calendar: { enabled: true },
        },
      }).calendar,
    ).toBe("unknown");
  });
});
