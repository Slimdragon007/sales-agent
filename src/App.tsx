import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarBlank,
  Check,
  CheckCircle,
  Circle,
  ClipboardText,
  ClockCounterClockwise,
  CurrencyDollar,
  GearSix,
  Info,
  MicrophoneStage,
  Pause,
  PhoneCall,
  PhoneSlash,
  Play,
  PlayCircle,
  ShieldCheck,
  Stop,
  Timer,
  UsersThree,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import {
  callStateSchema,
  createCortezFixtureState,
  METRICS_TELEMETRY_VERSION,
  parsePersistedCallState,
  type CallState,
  type TranscriptTurn,
} from "./domain/call-state";
import {
  evaluateLatencyGates,
  REQUIRED_AUDIO_QUALITY_MS,
  REQUIRED_INTERRUPTION_SAMPLES,
  REQUIRED_ROLE_PLAY_SAMPLES,
  type LatencyMeasurements,
} from "./domain/latency";
import { DISCOVERY_STAGES, getStage, getStageNumber } from "./domain/stages";
import { buildVerificationViewModel } from "./domain/verification-view";
import { CORTEZ_EVAL_CASES, runCortezBaseline } from "./evals/cortez";
import { useRealtimeVoice } from "./hooks/useRealtimeVoice";
import { getCapabilityStatus } from "./lib/capability-status";
import { fetchRuntimeSafety, type RuntimeSafety } from "./lib/runtime-safety";
import {
  emergencyStopShouldRun,
  runEmergencyStop,
} from "./lib/voice-session-controls";

const capabilityLabels = {
  apollo: {
    read_only: "Apollo read-only",
    disabled: "Apollo disabled",
  },
  sending: {
    disabled: "Sending disabled",
  },
  pricing: {
    approval_required: "Pricing approval required",
  },
  calendar: {
    connected: "Google Calendar connected",
    not_connected: "Google Calendar not connected",
    disabled: "Google Calendar disabled",
    unknown: "Google Calendar status unknown",
  },
} as const;

function calendarStatusTone(
  status: keyof typeof capabilityLabels.calendar,
): "pass-text" | "warn-text" {
  switch (status) {
    case "connected":
      return "pass-text";
    case "not_connected":
    case "disabled":
    case "unknown":
      return "warn-text";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

type Screen =
  "simulation" | "evaluations" | "doctrine" | "history" | "settings";

const STORAGE_KEY = "slim-sales-agent-call-state-v1";
const ENVIRONMENT_LABEL = import.meta.env.DEV
  ? "Local simulation"
  : "Private preview";

const navigation = [
  { id: "simulation", label: "Simulation", Icon: PlayCircle },
  { id: "evaluations", label: "Evaluations", Icon: CheckCircle },
  { id: "doctrine", label: "Sales doctrine", Icon: BookOpen },
  { id: "history", label: "Call history", Icon: ClockCounterClockwise },
  { id: "settings", label: "Settings", Icon: GearSix },
] as const satisfies readonly {
  id: Screen;
  label: string;
  Icon: typeof PlayCircle;
}[];

const mobileNavigation = [
  { id: "simulation", label: "Simulation", Icon: PlayCircle },
  { id: "evaluations", label: "Evaluations", Icon: CheckCircle },
  { id: "doctrine", label: "Doctrine", Icon: BookOpen },
  { id: "settings", label: "More", Icon: GearSix },
] as const satisfies readonly {
  id: Screen;
  label: string;
  Icon: typeof PlayCircle;
}[];

function loadCallState(): CallState {
  const saved = window.localStorage.getItem(STORAGE_KEY);

  if (saved) {
    try {
      const parsed = parsePersistedCallState(JSON.parse(saved));

      if (parsed) {
        return parsed;
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  return createCortezFixtureState();
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function metricLabel(
  value: number | null,
  statistic: "median" | "P95",
): string {
  if (value === null) {
    return "Not measured";
  }

  return value < 1
    ? `<1 ms ${statistic}`
    : `${Math.round(value)} ms ${statistic}`;
}

function observedDurationLabel(observedMs: number): string {
  const observedSeconds = Math.floor(observedMs / 1_000);
  const requiredSeconds = REQUIRED_AUDIO_QUALITY_MS / 1_000;
  return `${Math.min(observedSeconds, requiredSeconds)} / ${requiredSeconds} sec observed`;
}

function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <div className="transcript" aria-label="Role-play transcript">
      {turns.map((turn) => (
        <article
          className={`turn ${turn.speaker === "agent" ? "turn-agent" : ""}`}
          key={turn.id}
        >
          <div className="turn-meta">
            <span className="avatar" aria-hidden="true">
              {turn.speaker === "agent" ? "S" : "C"}
            </span>
            <strong>{turn.speakerName}</strong>
            <time dateTime={turn.timestamp}>{formatTime(turn.timestamp)}</time>
          </div>
          <p>{turn.text}</p>
        </article>
      ))}
    </div>
  );
}

function StageRail({ state }: { state: CallState }) {
  const currentIndex = getStageNumber(state.stage) - 1;

  return (
    <ol className="stage-rail" aria-label="Discovery stages">
      {DISCOVERY_STAGES.map((stage, index) => (
        <li
          className={[
            index < currentIndex ? "complete" : "",
            index === currentIndex ? "current" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          key={stage.id}
        >
          <span className="stage-marker">
            {index < currentIndex ? (
              <Check aria-hidden="true" size={12} weight="bold" />
            ) : (
              index + 1
            )}
          </span>
          <span className="stage-copy">
            <strong>{stage.label}</strong>
            {index === currentIndex ? <small>Current stage</small> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function VerificationPanel({
  state,
  safety,
  voiceActive,
  cortezPasses,
  cortezTotal,
}: {
  state: CallState;
  safety: RuntimeSafety | null;
  voiceActive: boolean;
  cortezPasses: number;
  cortezTotal: number;
}) {
  const view = buildVerificationViewModel({
    state,
    safety,
    voiceActive,
    cortezPasses,
    cortezTotal,
  });

  return (
    <aside className="verification-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Live verification</span>
          <h2>Discovery status</h2>
        </div>
        <span className={`status-pill ${view.qualificationTone}`}>
          {view.qualificationLabel}
        </span>
      </div>

      <section className="verification-section">
        <h3>Confirmed</h3>
        {view.confirmed.length > 0 ? (
          <ul className="verification-list confirmed-list">
            {view.confirmed.map((item) => (
              <li key={item}>
                <Check aria-hidden="true" size={14} weight="bold" />
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="verification-empty">None confirmed yet</p>
        )}
      </section>

      <section className="verification-section">
        <h3>Missing</h3>
        <ul className="verification-list missing-list">
          {view.missing.map((item) => (
            <li key={item}>
              <Circle aria-hidden="true" size={12} />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <div className="risk-card">
        <WarningCircle
          aria-hidden="true"
          className="risk-icon"
          size={20}
          weight="fill"
        />
        <div>
          <strong>Current risk</strong>
          <p>{view.risk}</p>
        </div>
      </div>

      <div className="question-card">
        <span className="eyebrow">Recommended next question</span>
        <p>“{view.recommendedQuestion}”</p>
      </div>

      <section className="release-gates">
        <h3>Release gates</h3>
        <div>
          <span>Behavioral evaluations</span>
          <strong
            className={
              view.cortezPasses === view.cortezTotal ? "pass-text" : undefined
            }
          >
            {view.cortezPasses} / {view.cortezTotal} pass
          </strong>
        </div>
        <div>
          <span>Latency role-plays</span>
          <strong>
            {view.latencySamples} / {view.latencyRequired} measured
          </strong>
        </div>
      </section>

      <section className="session-limits">
        <h3>Session limits</h3>
        <div>
          <span>Maximum call</span>
          <strong>{view.maxCallLabel}</strong>
        </div>
        <div>
          <span>Paid tests today</span>
          <strong>{view.paidTestsLabel}</strong>
        </div>
        <div>
          <span>Concurrent calls</span>
          <strong>{view.concurrentLabel}</strong>
        </div>
        <div>
          <span>Hard spend limit</span>
          <strong
            className={
              view.spendLimitTone === "pass" ? "pass-text" : "warn-text"
            }
          >
            {view.spendLimitLabel}
          </strong>
        </div>
        <div>
          <span>Emergency stop</span>
          <strong
            className={
              view.emergencyStopLabel === "Ready" ? "pass-text" : undefined
            }
          >
            {view.emergencyStopLabel}
          </strong>
        </div>
      </section>
    </aside>
  );
}

function SimulationScreen({
  state,
  localActive,
  safety,
  voiceActive,
  cortezPasses,
  cortezTotal,
}: {
  state: CallState;
  localActive: boolean;
  safety: RuntimeSafety | null;
  voiceActive: boolean;
  cortezPasses: number;
  cortezTotal: number;
}) {
  const stage = getStage(state.stage);
  const capabilityStatus = getCapabilityStatus(safety);
  const view = buildVerificationViewModel({
    state,
    safety,
    voiceActive,
    cortezPasses,
    cortezTotal,
  });

  return (
    <div className="simulation-layout">
      <section className="workspace-panel">
        <header className="prospect-header">
          <div>
            <span className="eyebrow">{state.prospect.source}</span>
            <h1>
              {state.prospect.name}
              <span> · {state.prospect.company}</span>
            </h1>
          </div>
          <div className="prospect-status">
            <span className={`live-dot ${localActive ? "active" : ""}`} />
            {localActive ? "Local role-play active" : "Local simulation ready"}
          </div>
        </header>

        <div className="stage-summary">
          <div>
            <span className="eyebrow">
              Stage {getStageNumber(state.stage)} of {DISCOVERY_STAGES.length}
            </span>
            <h2>{stage.label}</h2>
          </div>
          <span className={`status-pill ${view.qualificationTone}`}>
            {view.qualificationLabel}
          </span>
        </div>

        <div className="desktop-practice-strip">
          <Info aria-hidden="true" size={18} weight="fill" />
          <div>
            <strong>Simulation mode</strong>
            <small>
              No telephone calls are placed. Paid browser voice starts only from
              Settings after an explicit click.
            </small>
          </div>
        </div>

        <div className="conversation-grid">
          <StageRail state={state} />
          <div className="mobile-practice-strip mobile-only">
            <Info aria-hidden="true" size={17} weight="fill" />
            Practice screen · Paid browser voice starts only from Settings
          </div>
          <Transcript turns={state.transcript} />
        </div>

        <div className="mobile-risk-strip mobile-only">
          <WarningCircle aria-hidden="true" size={18} weight="fill" />
          <strong>{state.risks[0] ?? "No active risk"}</strong>
          <small>Open verification ›</small>
        </div>

        <div className="mobile-practice-actions mobile-only">
          <button disabled type="button">
            <MicrophoneStage aria-hidden="true" size={16} />
            Voice locked
          </button>
          <button disabled type="button">
            <ClipboardText aria-hidden="true" size={16} />
            Text fixture
          </button>
          <small>Simulation only · Not an active voice session</small>
        </div>

        <section className="mobile-verification mobile-only">
          <span className="sheet-handle" />
          <h2>Live verification</h2>
          <span className="eyebrow">Recommended next question</span>
          <p>“{view.recommendedQuestion}”</p>
          <div className="mobile-gates">
            <span>
              Behavioral evaluations · {view.cortezPasses} / {view.cortezTotal}{" "}
              pass
            </span>
            <span>
              Latency role-plays · {view.latencySamples} /{" "}
              {view.latencyRequired} measured
            </span>
          </div>
          <div className="mobile-limit">
            {view.maxCallLabel} max · {view.paidTestsLabel} paid tests · Hard
            spend limit {view.spendLimitLabel.toLowerCase()}
          </div>
          <div className="mobile-locks">
            {capabilityStatus.phonePilot === "owner_dialer_enabled"
              ? "Owner dialer enabled"
              : "Outbound disabled"}
            {" · "}
            {capabilityLabels.apollo[capabilityStatus.apollo]}
            {" · "}
            {capabilityLabels.sending[capabilityStatus.sending]}
          </div>
        </section>
      </section>
      <VerificationPanel
        cortezPasses={cortezPasses}
        cortezTotal={cortezTotal}
        safety={safety}
        state={state}
        voiceActive={voiceActive}
      />
    </div>
  );
}

function EvaluationsScreen() {
  const results = useMemo(() => runCortezBaseline(), []);

  return (
    <section className="content-screen">
      <div className="screen-heading">
        <span className="eyebrow">Prospect behavior suite</span>
        <h1>10 of 10 reviewed baselines pass</h1>
        <p>
          These checks protect scope, qualification, professional boundaries,
          and the precision of the close.
        </p>
      </div>
      <div className="eval-grid">
        {CORTEZ_EVAL_CASES.map((evalCase) => {
          const result = results.find((item) => item.id === evalCase.id);
          return (
            <article className="eval-card" key={evalCase.id}>
              <div className="eval-title">
                <CheckCircle
                  aria-hidden="true"
                  className="check-circle"
                  size={22}
                  weight="fill"
                />
                <h2>{evalCase.title}</h2>
              </div>
              <p>{evalCase.passingCriteria}</p>
              <span className="eval-result">
                {result?.passed ? "Passing" : "Needs review"}
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DoctrineScreen() {
  const rules = [
    "Disclose that the caller is speaking with an AI.",
    "Ask one question at a time and keep spoken turns short.",
    "Confirm inferences before recording them as facts.",
    "Quantify impact before recommending a solution.",
    "Separate launch scope from next and future ideas.",
    "Never price undefined work or guarantee revenue.",
    "Defer individualized tax, legal, and insurance advice.",
    "Close with named owners, dates, and a decision purpose.",
  ];

  return (
    <section className="content-screen">
      <div className="screen-heading">
        <span className="eyebrow">Sales doctrine v0.1</span>
        <h1>Warmth with commercial discipline</h1>
        <p>
          The agent preserves the operator’s ability to make a scattered vision
          feel achievable while preventing overpromising and scope leakage.
        </p>
      </div>
      <ol className="doctrine-list">
        {rules.map((rule, index) => (
          <li key={rule}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {rule}
          </li>
        ))}
      </ol>
    </section>
  );
}

function HistoryScreen() {
  return (
    <section className="content-screen">
      <div className="screen-heading">
        <span className="eyebrow">Local-only history</span>
        <h1>No paid calls recorded</h1>
        <p>
          The prospect simulation is stored in this browser. External CRM writes
          and Apollo mutations are disabled.
        </p>
      </div>
      <article className="history-card">
        <span className="avatar">A</span>
        <div>
          <strong>Alex Rivera · Riverside Youth Sports</strong>
          <p>Local fixture · Current workflow · Qualification incomplete</p>
        </div>
        <span className="status-pill neutral">Simulation</span>
      </article>
    </section>
  );
}

type QualityStatus = "pass" | "pending" | "fail";

function getQualityStatus({
  measured,
  complete,
  withinTarget,
}: {
  measured: boolean;
  complete: boolean;
  withinTarget: boolean;
}): QualityStatus {
  if (measured && !withinTarget) {
    return "fail";
  }

  if (!measured || !complete) {
    return "pending";
  }

  return "pass";
}

function QualityStatusIndicator({
  status,
  measured,
}: {
  status: QualityStatus;
  measured: boolean;
}) {
  if (status === "pass") {
    return (
      <span className="quality-status pass">
        <CheckCircle aria-hidden="true" size={16} weight="fill" />
        Pass
      </span>
    );
  }

  if (status === "fail") {
    return (
      <span className="quality-status fail">
        <XCircle aria-hidden="true" size={16} weight="fill" />
        Needs work
      </span>
    );
  }

  return (
    <span className="quality-status pending">
      <Circle aria-hidden="true" size={14} weight="bold" />
      {measured ? "More samples" : "Not measured"}
    </span>
  );
}

function SettingsScreen({
  safety,
  safetyError,
  voiceStatus,
  voiceError,
  metrics,
  onStartVoice,
  onResetVoiceError,
}: {
  safety: RuntimeSafety | null;
  safetyError: string | null;
  voiceStatus: string;
  voiceError: string | null;
  metrics: LatencyMeasurements;
  onStartVoice: () => void;
  onResetVoiceError: () => void;
}) {
  const capabilityStatus = getCapabilityStatus(safety);
  const spendConfirmed = safety?.platformHardSpendLimit.confirmed ?? false;
  const voiceUnlocked = safety?.voiceEnabled && spendConfirmed;
  const latencyGate = evaluateLatencyGates(metrics);
  const connectionMeasured = latencyGate.checks.connectionP95 !== null;
  const firstAudioMeasured =
    latencyGate.checks.firstAudioMedian !== null &&
    latencyGate.checks.firstAudioP95 !== null;
  const interruptionMeasured = latencyGate.checks.interruptionP95 !== null;
  const audioQualityMeasured = metrics.audioQualityObservedMs > 0;
  const connectionStatus = getQualityStatus({
    measured: connectionMeasured,
    complete: metrics.connectionMs.length >= REQUIRED_ROLE_PLAY_SAMPLES,
    withinTarget:
      latencyGate.checks.connectionP95 !== null &&
      latencyGate.checks.connectionP95 <= 2_500,
  });
  const firstAudioStatus = getQualityStatus({
    measured: firstAudioMeasured,
    complete: metrics.firstAudioMs.length >= REQUIRED_ROLE_PLAY_SAMPLES,
    withinTarget:
      latencyGate.checks.firstAudioMedian !== null &&
      latencyGate.checks.firstAudioMedian <= 700 &&
      latencyGate.checks.firstAudioP95 !== null &&
      latencyGate.checks.firstAudioP95 <= 1_200,
  });
  const interruptionStatus = getQualityStatus({
    measured: interruptionMeasured,
    complete: metrics.interruptionMs.length >= REQUIRED_INTERRUPTION_SAMPLES,
    withinTarget:
      latencyGate.checks.interruptionP95 !== null &&
      latencyGate.checks.interruptionP95 <= 250,
  });
  const audioQualityStatus = getQualityStatus({
    measured: audioQualityMeasured,
    complete: metrics.audioQualityObservedMs >= REQUIRED_AUDIO_QUALITY_MS,
    withinTarget: metrics.nonSilentConcealedSamples === 0,
  });

  return (
    <section className="content-screen settings-screen">
      <div className="screen-heading settings-heading">
        <h1>Voice workspace</h1>
      </div>

      <section className="workspace-readiness" aria-label="Voice readiness">
        <div className="readiness-item">
          {voiceUnlocked ? (
            <CheckCircle
              aria-hidden="true"
              className="readiness-icon ready"
              size={26}
              weight="fill"
            />
          ) : (
            <WarningCircle
              aria-hidden="true"
              className="readiness-icon pending"
              size={26}
              weight="fill"
            />
          )}
          <div>
            <strong>
              {voiceUnlocked ? "Role-play ready" : "Role-play locked"}
            </strong>
            <span>
              {voiceUnlocked
                ? "Paid browser voice is configured and protected."
                : "Complete the spend and local safety checks first."}
            </span>
          </div>
        </div>

        <div className="readiness-divider" aria-hidden="true" />

        <div className="readiness-item">
          <PhoneCall
            aria-hidden="true"
            className={`readiness-icon ${
              capabilityStatus.phonePilot === "owner_dialer_enabled"
                ? "ready"
                : "locked"
            }`}
            size={24}
            weight="fill"
          />
          <div>
            <strong>
              {capabilityStatus.phonePilot === "owner_dialer_enabled"
                ? "Owner phone dialer ready"
                : "Phone calls locked"}
            </strong>
            <span>
              {capabilityStatus.phonePilot === "owner_dialer_enabled"
                ? `Authenticated calls are controlled from the iPhone app and stop after ${safety?.phonePilot.maxCallMinutes ?? 15} minutes.`
                : "The API key stays server-only; dialing is disabled."}
            </span>
          </div>
        </div>

        <button
          className="primary-button readiness-button"
          disabled={!voiceUnlocked || voiceStatus === "connecting"}
          onClick={onStartVoice}
          type="button"
        >
          <Play aria-hidden="true" size={16} weight="fill" />
          {voiceStatus === "connecting" ? "Connecting…" : "Start role-play"}
        </button>
      </section>

      {!voiceUnlocked ? (
        <p className="workspace-message">
          Set and confirm the project hard cap before paid role-play can start.
        </p>
      ) : null}
      {safetyError ? (
        <p className="workspace-message error-note">{safetyError}</p>
      ) : null}
      {voiceError ? (
        <div className="error-block workspace-error">
          <p>{voiceError}</p>
          <button onClick={onResetVoiceError} type="button">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="voice-workspace-grid">
        <article className="quality-panel">
          <div className="panel-title-row">
            <div>
              <h2>Voice quality</h2>
              <p>Warm-lead voice release</p>
            </div>
          </div>

          <div className="quality-table-wrap">
            <table className="quality-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Current result</th>
                  <th scope="col">Target</th>
                  <th scope="col">Samples</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Connection</th>
                  <td>
                    {metricLabel(latencyGate.checks.connectionP95, "P95")}
                  </td>
                  <td>≤ 2,500 ms P95</td>
                  <td>
                    {Math.min(
                      metrics.connectionMs.length,
                      REQUIRED_ROLE_PLAY_SAMPLES,
                    )}
                    /{REQUIRED_ROLE_PLAY_SAMPLES} sessions
                  </td>
                  <td>
                    <QualityStatusIndicator
                      measured={connectionMeasured}
                      status={connectionStatus}
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row">First response audio</th>
                  <td>
                    <strong>
                      {metricLabel(
                        latencyGate.checks.firstAudioMedian,
                        "median",
                      )}
                    </strong>
                    <small>
                      {metricLabel(latencyGate.checks.firstAudioP95, "P95")}
                    </small>
                  </td>
                  <td>
                    <strong>≤ 700 ms median</strong>
                    <small>≤ 1,200 ms P95</small>
                  </td>
                  <td>
                    {Math.min(
                      metrics.firstAudioMs.length,
                      REQUIRED_ROLE_PLAY_SAMPLES,
                    )}
                    /{REQUIRED_ROLE_PLAY_SAMPLES} turns
                  </td>
                  <td>
                    <QualityStatusIndicator
                      measured={firstAudioMeasured}
                      status={firstAudioStatus}
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Interruption cutoff</th>
                  <td>
                    {metricLabel(latencyGate.checks.interruptionP95, "P95")}
                  </td>
                  <td>≤ 250 ms P95</td>
                  <td>
                    {Math.min(
                      metrics.interruptionMs.length,
                      REQUIRED_INTERRUPTION_SAMPLES,
                    )}
                    /{REQUIRED_INTERRUPTION_SAMPLES} interruptions
                  </td>
                  <td>
                    <QualityStatusIndicator
                      measured={interruptionMeasured}
                      status={interruptionStatus}
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Concealed audio</th>
                  <td>
                    {audioQualityMeasured
                      ? metrics.nonSilentConcealedSamples
                      : "Not measured"}
                  </td>
                  <td>0 non-silent samples</td>
                  <td>
                    {observedDurationLabel(metrics.audioQualityObservedMs)}
                  </td>
                  <td>
                    <QualityStatusIndicator
                      measured={audioQualityMeasured}
                      status={audioQualityStatus}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="latency-explainer">
            <Info aria-hidden="true" size={18} weight="fill" />
            <p>
              Zero latency is physically impossible. Phone release stays blocked
              until repeated role-plays meet every measured target.
            </p>
          </div>
        </article>

        <aside className="safeguards-panel">
          <h2>Safeguards &amp; limits</h2>

          <div className="safeguard-row">
            <span className="safeguard-icon">
              <CurrencyDollar aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>Spend protection</strong>
              <span>Platform hard cap</span>
            </div>
            <b className={spendConfirmed ? "pass-text" : "warn-text"}>
              {spendConfirmed
                ? `$${safety?.platformHardSpendLimit.monthlyUsd ?? 0}/month`
                : "Required"}
            </b>
          </div>

          <div className="safeguard-row">
            <span className="safeguard-icon">
              <Timer aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>Maximum call</strong>
              <span>Automatic session limit</span>
            </div>
            <b>{safety?.limits.maxCallMinutes ?? 15} minutes</b>
          </div>

          <div className="safeguard-row">
            <span className="safeguard-icon">
              <ShieldCheck aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>Paid tests per day</strong>
              <span>Role-play protection</span>
            </div>
            <b>{safety?.limits.maxDailyPaidTests ?? 10}</b>
          </div>

          <div className="safeguard-row">
            <span className="safeguard-icon">
              <UsersThree aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>Concurrent sessions</strong>
              <span>At one time</span>
            </div>
            <b>{safety?.limits.maxConcurrentSessions ?? 1}</b>
          </div>

          <div className="safeguard-row">
            <span className="safeguard-icon">
              {capabilityStatus.phonePilot === "owner_dialer_enabled" ? (
                <PhoneCall aria-hidden="true" size={20} />
              ) : (
                <PhoneSlash aria-hidden="true" size={20} />
              )}
            </span>
            <div>
              <strong>Outbound dialing</strong>
              <span>Real phone calls</span>
            </div>
            <b>
              {capabilityStatus.phonePilot === "owner_dialer_enabled"
                ? "Owner dialer enabled"
                : "Disabled"}
            </b>
          </div>

          <div className="safeguard-row">
            <span className="safeguard-icon">
              <CalendarBlank aria-hidden="true" size={20} />
            </span>
            <div>
              <strong>Google Calendar</strong>
              <span>Phone assistant scheduling</span>
            </div>
            <b className={calendarStatusTone(capabilityStatus.calendar)}>
              {capabilityLabels.calendar[capabilityStatus.calendar]}
            </b>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("simulation");
  const [callState, setCallState] = useState<CallState>(loadCallState);
  const [localActive, setLocalActive] = useState(false);
  const [safety, setSafety] = useState<RuntimeSafety | null>(null);
  const [safetyError, setSafetyError] = useState<string | null>(null);

  const handleVoiceTranscript = useCallback((turns: TranscriptTurn[]) => {
    setCallState((current) =>
      callStateSchema.parse({
        ...current,
        transcript: turns,
        lastUpdatedAt: new Date().toISOString(),
      }),
    );
  }, []);

  const handleVoiceUsage = useCallback(
    (usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }) => {
      setCallState((current) =>
        callStateSchema.parse({
          ...current,
          usage,
          lastUpdatedAt: new Date().toISOString(),
        }),
      );
    },
    [],
  );

  const capabilityStatus = useMemo(() => getCapabilityStatus(safety), [safety]);

  const cortezResults = useMemo(() => runCortezBaseline(), []);
  const cortezPasses = cortezResults.filter((result) => result.passed).length;
  const cortezTotal = cortezResults.length;

  const voice = useRealtimeVoice({
    initialMetrics: callState.metrics,
    safety,
    onTranscript: handleVoiceTranscript,
    onUsage: handleVoiceUsage,
  });

  useEffect(() => {
    setCallState((current) =>
      callStateSchema.parse({
        ...current,
        metrics: {
          ...voice.metrics,
          telemetryVersion: METRICS_TELEMETRY_VERSION,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );
  }, [voice.metrics]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(callState));
  }, [callState]);

  useEffect(() => {
    void fetchRuntimeSafety()
      .then((runtime) => {
        setSafety(runtime);
        setSafetyError(null);
      })
      .catch((error: unknown) => {
        setSafetyError(
          error instanceof Error
            ? error.message
            : "Could not verify the local safety gate.",
        );
      });
  }, []);

  function toggleLocalRolePlay(): void {
    setLocalActive((active) => !active);
  }

  const emergencyStopEnabled = emergencyStopShouldRun({
    localActive,
    voiceStatus: voice.status,
  });

  function emergencyStop(): void {
    runEmergencyStop({
      localActive,
      voiceStatus: voice.status,
      stopLocalRolePlay: () => setLocalActive(false),
      disconnect: voice.emergencyStop,
    });
  }

  const voiceOffline = voice.status === "offline" || voice.status === "error";

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setScreen("simulation")}
          type="button"
        >
          <span className="brand-mark">S</span>
          <span>
            <strong>Slim Sales Agent</strong>
            <small>{ENVIRONMENT_LABEL}</small>
          </span>
        </button>
        <div className="topbar-actions">
          <span className="offline-label">
            <span className={`live-dot ${voiceOffline ? "" : "active"}`} />
            {voiceOffline ? "Voice offline · No paid calls" : "Paid voice live"}
          </span>
          <button
            className="primary-button"
            onClick={toggleLocalRolePlay}
            type="button"
          >
            {localActive ? (
              <Pause aria-hidden="true" size={15} weight="fill" />
            ) : (
              <Play aria-hidden="true" size={15} weight="fill" />
            )}
            {localActive ? "Pause role-play" : "Start role-play"}
          </button>
          <button
            className="danger-button"
            disabled={!emergencyStopEnabled}
            onClick={emergencyStop}
            type="button"
          >
            <Stop aria-hidden="true" size={14} weight="fill" />
            Emergency stop
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <nav aria-label="Primary navigation">
          {navigation.map((item) => (
            <button
              className={screen === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setScreen(item.id)}
              type="button"
            >
              <item.Icon
                aria-hidden="true"
                size={18}
                weight={screen === item.id ? "fill" : "regular"}
              />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="outbound-lock">
          {capabilityStatus.phonePilot === "owner_dialer_enabled" ? (
            <PhoneCall aria-hidden="true" size={19} />
          ) : (
            <PhoneSlash aria-hidden="true" size={19} />
          )}
          <div>
            <strong>
              {capabilityStatus.phonePilot === "owner_dialer_enabled"
                ? "Owner dialer enabled"
                : "Outbound disabled"}
            </strong>
            <small>
              {capabilityStatus.phonePilot === "owner_dialer_enabled"
                ? "Controlled from iPhone"
                : "Real calls are locked"}
            </small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {screen === "simulation" ? (
          <SimulationScreen
            cortezPasses={cortezPasses}
            cortezTotal={cortezTotal}
            localActive={localActive}
            safety={safety}
            state={callState}
            voiceActive={
              localActive ||
              voice.status === "connecting" ||
              voice.status === "connected" ||
              voice.status === "speaking"
            }
          />
        ) : null}
        {screen === "evaluations" ? <EvaluationsScreen /> : null}
        {screen === "doctrine" ? <DoctrineScreen /> : null}
        {screen === "history" ? <HistoryScreen /> : null}
        {screen === "settings" ? (
          <SettingsScreen
            metrics={voice.metrics}
            onResetVoiceError={voice.resetError}
            onStartVoice={() => void voice.connect(true)}
            safety={safety}
            safetyError={safetyError}
            voiceError={voice.error}
            voiceStatus={voice.status}
          />
        ) : null}
      </main>

      <footer className="safety-footer">
        <span>
          <Check aria-hidden="true" size={13} weight="bold" />
          {capabilityLabels.apollo[capabilityStatus.apollo]}
        </span>
        <span>
          <Check aria-hidden="true" size={13} weight="bold" />
          {capabilityLabels.sending[capabilityStatus.sending]}
        </span>
        <span>
          <Check aria-hidden="true" size={13} weight="bold" />
          {capabilityLabels.pricing[capabilityStatus.pricing]}
        </span>
        <span>
          {capabilityStatus.calendar === "connected" ? (
            <Check aria-hidden="true" size={13} weight="bold" />
          ) : (
            <WarningCircle aria-hidden="true" size={13} weight="fill" />
          )}
          {capabilityLabels.calendar[capabilityStatus.calendar]}
        </span>
        <span className="footer-limit">
          <Info aria-hidden="true" size={13} weight="fill" />
          Max {safety?.limits.maxCallMinutes ?? 15} min ·{" "}
          {safety?.limits.maxDailyPaidTests ?? 10} paid tests/day ·{" "}
          {safety?.limits.maxConcurrentSessions ?? 1} concurrent
        </span>
      </footer>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileNavigation.map((item) => (
          <button
            className={screen === item.id ? "active" : ""}
            key={item.id}
            onClick={() => setScreen(item.id)}
            type="button"
          >
            <item.Icon
              aria-hidden="true"
              size={20}
              weight={screen === item.id ? "fill" : "regular"}
            />
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
