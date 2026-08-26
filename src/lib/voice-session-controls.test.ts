import { describe, expect, it, vi } from "vitest";
import {
  canRequestPaidClientSecret,
  emergencyStopShouldRun,
  runEmergencyStop,
} from "./voice-session-controls";

describe("canRequestPaidClientSecret", () => {
  it("forbids paid client-secret requests without explicit user initiation", () => {
    expect(
      canRequestPaidClientSecret({
        userInitiated: false,
        safety: {
          voiceEnabled: true,
          platformHardSpendLimit: { confirmed: true, monthlyUsd: 10 },
        },
      }),
    ).toBe(false);
  });

  it("allows paid client-secret requests when user-initiated and safety passes", () => {
    expect(
      canRequestPaidClientSecret({
        userInitiated: true,
        safety: {
          voiceEnabled: true,
          platformHardSpendLimit: { confirmed: true, monthlyUsd: 10 },
        },
      }),
    ).toBe(true);
  });

  it("blocks when safety is missing or voice is locked", () => {
    expect(
      canRequestPaidClientSecret({ userInitiated: true, safety: null }),
    ).toBe(false);
    expect(
      canRequestPaidClientSecret({
        userInitiated: true,
        safety: {
          voiceEnabled: false,
          platformHardSpendLimit: { confirmed: true, monthlyUsd: 10 },
        },
      }),
    ).toBe(false);
    expect(
      canRequestPaidClientSecret({
        userInitiated: true,
        safety: {
          voiceEnabled: true,
          platformHardSpendLimit: { confirmed: false, monthlyUsd: null },
        },
      }),
    ).toBe(false);
  });
});

describe("emergencyStopShouldRun", () => {
  it("allows emergency stop only when a session is active", () => {
    expect(
      emergencyStopShouldRun({ localActive: true, voiceStatus: "offline" }),
    ).toBe(true);
    expect(
      emergencyStopShouldRun({ localActive: false, voiceStatus: "connected" }),
    ).toBe(true);
    expect(
      emergencyStopShouldRun({ localActive: false, voiceStatus: "offline" }),
    ).toBe(false);
  });

  it("enables stop for connecting and speaking voice states", () => {
    expect(
      emergencyStopShouldRun({
        localActive: false,
        voiceStatus: "connecting",
      }),
    ).toBe(true);
    expect(
      emergencyStopShouldRun({ localActive: false, voiceStatus: "speaking" }),
    ).toBe(true);
  });

  it("disables stop when idle or errored without local role-play", () => {
    expect(
      emergencyStopShouldRun({ localActive: false, voiceStatus: "error" }),
    ).toBe(false);
    expect(
      emergencyStopShouldRun({ localActive: false, voiceStatus: "stopped" }),
    ).toBe(false);
  });
});

describe("runEmergencyStop", () => {
  it("stops local role-play and disconnects when a session is active", () => {
    const stopLocalRolePlay = vi.fn();
    const disconnect = vi.fn();

    expect(
      runEmergencyStop({
        localActive: true,
        voiceStatus: "offline",
        stopLocalRolePlay,
        disconnect,
      }),
    ).toBe(true);
    expect(stopLocalRolePlay).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects live voice without local role-play", () => {
    const stopLocalRolePlay = vi.fn();
    const disconnect = vi.fn();

    expect(
      runEmergencyStop({
        localActive: false,
        voiceStatus: "connected",
        stopLocalRolePlay,
        disconnect,
      }),
    ).toBe(true);
    expect(stopLocalRolePlay).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no session is active", () => {
    const stopLocalRolePlay = vi.fn();
    const disconnect = vi.fn();

    expect(
      runEmergencyStop({
        localActive: false,
        voiceStatus: "offline",
        stopLocalRolePlay,
        disconnect,
      }),
    ).toBe(false);
    expect(stopLocalRolePlay).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });
});
