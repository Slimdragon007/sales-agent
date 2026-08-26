export type VoiceSession = {
  interrupt(): void;
  close(): void;
};

export type VoiceSessionDisconnectTimers = {
  stopTimerId: number | null;
  statsTimerId: number | null;
};

export type VoiceSessionDisconnectHandles = {
  session: VoiceSession | null;
  mediaStream: MediaStream | null;
};

export type VoiceSessionDisconnectCallbacks = {
  clearTimeout: (timerId: number) => void;
  clearInterval: (timerId: number) => void;
  releaseLease: () => void;
  onDisconnected: () => void;
};

export function performVoiceSessionDisconnect(
  timers: VoiceSessionDisconnectTimers,
  handles: VoiceSessionDisconnectHandles,
  callbacks: VoiceSessionDisconnectCallbacks,
): VoiceSessionDisconnectTimers {
  if (timers.stopTimerId !== null) {
    callbacks.clearTimeout(timers.stopTimerId);
  }

  if (timers.statsTimerId !== null) {
    callbacks.clearInterval(timers.statsTimerId);
  }

  handles.session?.interrupt();
  handles.session?.close();
  handles.session = null;
  handles.mediaStream?.getTracks().forEach((track) => track.stop());
  handles.mediaStream = null;
  callbacks.releaseLease();
  callbacks.onDisconnected();

  return {
    stopTimerId: null,
    statsTimerId: null,
  };
}
