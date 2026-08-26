import { describe, expect, it, vi } from "vitest";
import { performVoiceSessionDisconnect } from "./voice-session-disconnect";

describe("performVoiceSessionDisconnect", () => {
  it("clears timers, closes the session, stops media tracks, and releases the lease", () => {
    const clearTimeout = vi.fn();
    const clearInterval = vi.fn();
    const releaseLease = vi.fn();
    const onDisconnected = vi.fn();
    const interrupt = vi.fn();
    const close = vi.fn();
    const stop = vi.fn();
    const session = { interrupt, close };
    const mediaStream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const handles = { session, mediaStream };

    const clearedTimers = performVoiceSessionDisconnect(
      { stopTimerId: 11, statsTimerId: 22 },
      handles,
      { clearTimeout, clearInterval, releaseLease, onDisconnected },
    );

    expect(clearTimeout).toHaveBeenCalledWith(11);
    expect(clearInterval).toHaveBeenCalledWith(22);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(clearedTimers).toEqual({ stopTimerId: null, statsTimerId: null });
    expect(handles.session).toBeNull();
    expect(handles.mediaStream).toBeNull();
  });

  it("still releases resources when no session or media stream is active", () => {
    const releaseLease = vi.fn();
    const onDisconnected = vi.fn();

    performVoiceSessionDisconnect(
      { stopTimerId: null, statsTimerId: null },
      { session: null, mediaStream: null },
      {
        clearTimeout: vi.fn(),
        clearInterval: vi.fn(),
        releaseLease,
        onDisconnected,
      },
    );

    expect(releaseLease).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });
});
