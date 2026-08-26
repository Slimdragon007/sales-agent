import { z } from "zod";
import { callStageSchema, type CallStage } from "./stages";

export const METRICS_TELEMETRY_VERSION = 3;

export const callModeSchema = z.enum([
  "local_simulation",
  "warm_referral",
  "inbound",
  "consented_outbound",
]);

export const qualificationStatusSchema = z.enum([
  "incomplete",
  "qualified",
  "nurture",
  "disqualified",
]);

const transcriptTurnSchema = z.object({
  id: z.string().min(1),
  speaker: z.enum(["prospect", "agent"]),
  speakerName: z.string().min(1),
  text: z.string().min(1),
  timestamp: z.string().datetime(),
});

const decisionMakerSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
});

const nextActionSchema = z.object({
  prospectResponsibilities: z.array(z.string().min(1)),
  sellerResponsibilities: z.array(z.string().min(1)),
  meetingPurpose: z.string().min(1).nullable(),
  scheduledAt: z.string().datetime().nullable(),
});

export const callStateSchema = z.object({
  callId: z.string().min(1),
  mode: callModeSchema,
  stage: callStageSchema,
  startedAt: z.string().datetime().nullable(),
  lastUpdatedAt: z.string().datetime(),
  prospect: z.object({
    name: z.string().min(1),
    preferredName: z.string().min(1),
    company: z.string().min(1),
    role: z.string().min(1),
    source: z.string().min(1),
  }),
  consent: z.object({
    aiDisclosed: z.boolean(),
    recordingPermission: z.boolean(),
    disclosureAt: z.string().datetime().nullable(),
  }),
  desiredOutcomes: z.array(z.string().min(1)),
  currentWorkflow: z.array(z.string().min(1)),
  confirmedPains: z.array(z.string().min(1)),
  businessImpacts: z.array(z.string().min(1)),
  emotionalMotives: z.array(z.string().min(1)),
  offers: z.array(
    z.object({
      name: z.string().min(1),
      price: z.number().nonnegative().nullable(),
    }),
  ),
  activeCustomers: z.number().int().nonnegative().nullable(),
  averageCustomerValue: z.number().nonnegative().nullable(),
  authority: z.object({
    decisionMaker: decisionMakerSchema.nullable(),
    otherStakeholders: z.array(decisionMakerSchema),
  }),
  budget: z.object({
    minimum: z.number().nonnegative().nullable(),
    maximum: z.number().nonnegative().nullable(),
    currency: z.literal("USD"),
    confidence: z.enum(["unknown", "low", "medium", "high"]),
  }),
  timeline: z.object({
    targetDate: z.string().min(1).nullable(),
    reason: z.string().min(1).nullable(),
  }),
  scope: z.object({
    launch: z.array(z.string().min(1)),
    next: z.array(z.string().min(1)),
    future: z.array(z.string().min(1)),
  }),
  risks: z.array(z.string().min(1)),
  missingFields: z.array(z.string().min(1)),
  qualification: z.object({
    status: qualificationStatusSchema,
    score: z.number().int().min(0).max(100).nullable(),
    reasoning: z.array(z.string().min(1)),
  }),
  nextAction: nextActionSchema,
  transcript: z.array(transcriptTurnSchema),
  metrics: z.object({
    telemetryVersion: z.literal(METRICS_TELEMETRY_VERSION),
    connectionMs: z.array(z.number().nonnegative()),
    firstAudioMs: z.array(z.number().nonnegative()),
    interruptionMs: z.array(z.number().nonnegative()),
    audioConcealmentEvents: z.number().int().nonnegative(),
    nonSilentConcealedSamples: z.number().int().nonnegative(),
    audioQualityObservedMs: z.number().nonnegative().default(0),
  }),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  runtime: z.object({
    status: z.enum([
      "offline",
      "connecting",
      "connected",
      "speaking",
      "stopped",
      "error",
    ]),
    leaseId: z.string().uuid().nullable(),
    errorMessage: z.string().nullable(),
  }),
});

export type CallState = z.infer<typeof callStateSchema>;
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
export type QualificationStatus = z.infer<typeof qualificationStatusSchema>;

export function parsePersistedCallState(value: unknown): CallState | null {
  const persistedMetrics =
    typeof value === "object" &&
    value !== null &&
    "metrics" in value &&
    typeof value.metrics === "object" &&
    value.metrics !== null
      ? value.metrics
      : null;
  const persistedTelemetryVersion =
    persistedMetrics !== null &&
    "telemetryVersion" in persistedMetrics &&
    typeof persistedMetrics.telemetryVersion === "number"
      ? persistedMetrics.telemetryVersion
      : null;
  const migratedMetrics =
    persistedTelemetryVersion === 2
      ? {
          ...persistedMetrics,
          telemetryVersion: METRICS_TELEMETRY_VERSION,
          audioConcealmentEvents: 0,
          nonSilentConcealedSamples: 0,
          audioQualityObservedMs: 0,
        }
      : {
          telemetryVersion: METRICS_TELEMETRY_VERSION,
          connectionMs: [],
          firstAudioMs: [],
          interruptionMs: [],
          audioConcealmentEvents: 0,
          nonSilentConcealedSamples: 0,
          audioQualityObservedMs: 0,
        };
  const candidate =
    persistedTelemetryVersion === METRICS_TELEMETRY_VERSION
      ? value
      : typeof value === "object" && value !== null
        ? { ...value, metrics: migratedMetrics }
        : value;
  const parsed = callStateSchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
}

const factCategorySchema = z.enum([
  "desiredOutcomes",
  "currentWorkflow",
  "confirmedPains",
  "businessImpacts",
  "emotionalMotives",
]);

export const callEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage_changed"),
    stage: callStageSchema,
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("consent_updated"),
    aiDisclosed: z.boolean(),
    recordingPermission: z.boolean(),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("transcript_added"),
    turn: transcriptTurnSchema,
  }),
  z.object({
    type: z.literal("fact_added"),
    category: factCategorySchema,
    value: z.string().min(1),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("scope_added"),
    bucket: z.enum(["launch", "next", "future"]),
    value: z.string().min(1),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("risk_added"),
    value: z.string().min(1),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("missing_fields_replaced"),
    values: z.array(z.string().min(1)),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("qualification_replaced"),
    status: qualificationStatusSchema,
    score: z.number().int().min(0).max(100),
    reasoning: z.array(z.string().min(1)),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("next_action_replaced"),
    value: nextActionSchema,
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("latency_sample_added"),
    metric: z.enum(["connectionMs", "firstAudioMs", "interruptionMs"]),
    value: z.number().nonnegative(),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("usage_replaced"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("runtime_replaced"),
    status: callStateSchema.shape.runtime.shape.status,
    leaseId: z.string().uuid().nullable(),
    errorMessage: z.string().nullable(),
    occurredAt: z.string().datetime(),
  }),
]);

export type CallEvent = z.infer<typeof callEventSchema>;

function appendUnique(values: string[], value: string): string[] {
  const normalized = value.trim();

  if (
    values.some(
      (existing) => existing.toLocaleLowerCase() === normalized.toLowerCase(),
    )
  ) {
    return values;
  }

  return [...values, normalized];
}

export function reduceCallState(
  currentState: CallState,
  unparsedEvent: CallEvent,
): CallState {
  const event = callEventSchema.parse(unparsedEvent);
  let nextState: CallState;

  switch (event.type) {
    case "stage_changed":
      nextState = {
        ...currentState,
        stage: event.stage,
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "consent_updated":
      nextState = {
        ...currentState,
        consent: {
          aiDisclosed: event.aiDisclosed,
          recordingPermission: event.recordingPermission,
          disclosureAt: event.aiDisclosed ? event.occurredAt : null,
        },
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "transcript_added":
      nextState = {
        ...currentState,
        transcript: [...currentState.transcript, event.turn],
        lastUpdatedAt: event.turn.timestamp,
      };
      break;
    case "fact_added":
      nextState = {
        ...currentState,
        [event.category]: appendUnique(
          currentState[event.category],
          event.value,
        ),
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "scope_added":
      nextState = {
        ...currentState,
        scope: {
          ...currentState.scope,
          [event.bucket]: appendUnique(
            currentState.scope[event.bucket],
            event.value,
          ),
        },
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "risk_added":
      nextState = {
        ...currentState,
        risks: appendUnique(currentState.risks, event.value),
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "missing_fields_replaced":
      nextState = {
        ...currentState,
        missingFields: [...event.values],
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "qualification_replaced":
      nextState = {
        ...currentState,
        qualification: {
          status: event.status,
          score: event.score,
          reasoning: [...event.reasoning],
        },
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "next_action_replaced":
      nextState = {
        ...currentState,
        nextAction: event.value,
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "latency_sample_added":
      nextState = {
        ...currentState,
        metrics: {
          ...currentState.metrics,
          [event.metric]: [...currentState.metrics[event.metric], event.value],
        },
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "usage_replaced":
      nextState = {
        ...currentState,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
        },
        lastUpdatedAt: event.occurredAt,
      };
      break;
    case "runtime_replaced":
      nextState = {
        ...currentState,
        runtime: {
          status: event.status,
          leaseId: event.leaseId,
          errorMessage: event.errorMessage,
        },
        lastUpdatedAt: event.occurredAt,
      };
      break;
  }

  return callStateSchema.parse(nextState);
}

export function getMinimumDiscoveryMissing(state: CallState): string[] {
  const missing: string[] = [];

  if (state.desiredOutcomes.length === 0) {
    missing.push("Desired outcome");
  }
  if (state.currentWorkflow.length === 0) {
    missing.push("Current workflow");
  }
  if (state.confirmedPains.length === 0) {
    missing.push("Confirmed operational pain");
  }
  if (state.businessImpacts.length === 0) {
    missing.push("Quantified business impact");
  }
  if (state.authority.decisionMaker === null) {
    missing.push("Decision authority");
  }
  if (state.timeline.targetDate === null || state.timeline.reason === null) {
    missing.push("Timing and reason");
  }
  if (state.scope.launch.length === 0) {
    missing.push("Phase-one priority");
  }

  return missing;
}

export function isMinimumDiscoveryComplete(state: CallState): boolean {
  return getMinimumDiscoveryMissing(state).length === 0;
}

export function getRecommendedNextQuestion(state: CallState): string {
  const [firstMissing] = getMinimumDiscoveryMissing(state);

  switch (firstMissing) {
    case "Desired outcome":
      return "What would need to be different for this project to feel successful?";
    case "Current workflow":
      return "Walk me through what happens from the moment a new client first contacts you.";
    case "Confirmed operational pain":
      return "Which part of that workflow creates the most friction for you?";
    case "Quantified business impact":
      return "How much time do those manual tasks take during a normal week?";
    case "Decision authority":
      return "Who besides you would need to be involved in deciding what happens next?";
    case "Timing and reason":
      return "What makes that target date important for the business?";
    case "Phase-one priority":
      return "Of everything you described, which outcome must work first at launch?";
    default:
      return "Would it be useful if I summarized what I heard and proposed the next step?";
  }
}

export function createCortezFixtureState(): CallState {
  return callStateSchema.parse({
    callId: "cortez-local-simulation",
    mode: "local_simulation",
    stage: "current_workflow",
    startedAt: null,
    lastUpdatedAt: "2026-07-29T16:32:43.000Z",
    prospect: {
      name: "Alex Rivera",
      preferredName: "Alex",
      company: "Riverside Youth Sports",
      role: "Owner",
      source: "Warm referral from Jordan Lee",
    },
    consent: {
      aiDisclosed: true,
      recordingPermission: true,
      disclosureAt: "2026-07-29T16:30:00.000Z",
    },
    desiredOutcomes: [
      "Create a structured online basketball training business",
    ],
    currentWorkflow: [
      "New parents usually contact Alex by text or direct message",
      "Programs and reminders live in his head, phone, or sticky notes",
    ],
    confirmedPains: ["The current workflow is manual and unstructured"],
    businessImpacts: [],
    emotionalMotives: ["Relief from operational overwhelm"],
    offers: [],
    activeCustomers: null,
    averageCustomerValue: null,
    authority: {
      decisionMaker: {
        name: "Alex Rivera",
        role: "Owner",
      },
      otherStakeholders: [],
    },
    budget: {
      minimum: null,
      maximum: null,
      currency: "USD",
      confidence: "unknown",
    },
    timeline: {
      targetDate: "August",
      reason: "Wants the structure ready before expanding online",
    },
    scope: {
      launch: [],
      next: [],
      future: [
        "Ten-thousand-square-foot facility",
        "Automated basketball shot analysis",
      ],
    },
    risks: ["Scope expanding beyond launch"],
    missingFields: [
      "Administrative hours per week",
      "Missed renewals or payments",
      "Phase-one priority",
      "Available investment range",
    ],
    qualification: {
      status: "incomplete",
      score: null,
      reasoning: [],
    },
    nextAction: {
      prospectResponsibilities: [],
      sellerResponsibilities: [],
      meetingPurpose: null,
      scheduledAt: null,
    },
    transcript: [
      {
        id: "turn-1",
        speaker: "prospect",
        speakerName: "Alex Rivera",
        text: "I have all the knowledge. I just don’t have structure and I don’t have an online system.",
        timestamp: "2026-07-29T16:32:11.000Z",
      },
      {
        id: "turn-2",
        speaker: "agent",
        speakerName: "Slim Sales Agent",
        text: "Walk me through what happens from the moment a parent first contacts you.",
        timestamp: "2026-07-29T16:32:16.000Z",
      },
      {
        id: "turn-3",
        speaker: "prospect",
        speakerName: "Alex Rivera",
        text: "They usually text or DM me. I reply when I can. Then I send some info, try to set up a time, and keep it all in my head or on sticky notes.",
        timestamp: "2026-07-29T16:32:24.000Z",
      },
      {
        id: "turn-4",
        speaker: "agent",
        speakerName: "Slim Sales Agent",
        text: "Got it. Once you set up that initial conversation, what does the rest of the process look like right now?",
        timestamp: "2026-07-29T16:32:33.000Z",
      },
      {
        id: "turn-5",
        speaker: "prospect",
        speakerName: "Alex Rivera",
        text: "We talk, I gauge their needs, and then I try to match them with the right program. It works, but it’s messy and takes a lot of time.",
        timestamp: "2026-07-29T16:32:43.000Z",
      },
    ],
    metrics: {
      telemetryVersion: METRICS_TELEMETRY_VERSION,
      connectionMs: [],
      firstAudioMs: [],
      interruptionMs: [],
      audioConcealmentEvents: 0,
      nonSilentConcealedSamples: 0,
      audioQualityObservedMs: 0,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    runtime: {
      status: "offline",
      leaseId: null,
      errorMessage: null,
    },
  });
}

export function canAdvanceTo(
  state: CallState,
  requestedStage: CallStage,
): boolean {
  if (requestedStage === "recommendation") {
    return isMinimumDiscoveryComplete(state);
  }

  if (requestedStage === "mutual_action_plan") {
    return state.qualification.status !== "incomplete";
  }

  return true;
}
