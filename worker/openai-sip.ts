import OpenAI from "openai";
import type { CallAcceptParams } from "openai/resources/realtime/calls";
import type { RealtimeCallIncomingWebhookEvent } from "openai/resources/webhooks/webhooks";
import { buildPhoneCallInstructions } from "../src/agent/instructions";
import { REALTIME_MODEL, REALTIME_VOICE } from "../src/lib/realtime-config";
import {
  buildGoogleCalendarReadTool,
  buildGoogleCalendarWriteTools,
  createGoogleCalendarEvent,
  objectiveAllowsCalendarWrites,
  parseCreateCalendarEventArgs,
  parseUpdateCalendarEventArgs,
  updateGoogleCalendarEvent,
} from "./google-calendar";

const MAX_WEBHOOK_BYTES = 64 * 1_024;
const LEASE_HEADER = "x-slim-lease-id";
const CLAIM_TOKEN_HEADER = "x-slim-claim-token";
export const CALENDAR_TOOLING_ACCEPT_TIMEOUT_MS = 1_000;

export const PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS =
  "Begin the call now. Briefly say: hey, this is the operator's assistant, designed to handle calls and requests for them — you're their secretary right now. Disclose that you are an AI assistant and that the call is not recorded, then ask whether the person is comfortable continuing. Ask only that one question, then wait.";

type BackgroundTask = (promise: Promise<unknown>) => void;

export type PhoneCalendarTooling = {
  accessToken: string;
  allowWrites: boolean;
};

type OpenAISipWebhookOptions = {
  apiKey: string;
  projectId: string;
  webhookSecret: string;
  claimCallObjective: (
    leaseId: string,
    claimToken: string,
    openAiCallId: string,
  ) => Promise<string | null>;
  claimSoleActiveCallObjective?: (
    openAiCallId: string,
  ) => Promise<{ leaseId: string; callObjective: string } | null>;
  recordWebhookDiagnostic?: (diagnostic: {
    receivedAt: number;
    signatureOk: boolean;
    eventType: string | null;
    hasWebhookIdHeader: boolean;
    hasLeaseHeader: boolean;
    hasClaimHeader: boolean;
    sipHeaderCount: number;
    claimMode: "headers" | "sole_active" | "rejected" | "skipped";
    accepted: boolean;
    detail: string | null;
  }) => Promise<void>;
  resolveCalendarTooling?: (
    callObjective: string,
  ) => Promise<PhoneCalendarTooling | null>;
  waitUntil: BackgroundTask;
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function logSipWebhookEvent(
  event: string,
  details: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      event,
      ...details,
    }),
  );
}

/**
 * Resolve calendar tooling for SIP accept without blocking the answer path.
 * Timeout or resolver errors fail open to null so OpenAI can accept immediately.
 */
export async function resolveCalendarToolingForAccept(
  resolveCalendarTooling:
    | ((callObjective: string) => Promise<PhoneCalendarTooling | null>)
    | undefined,
  callObjective: string,
  timeoutMs = CALENDAR_TOOLING_ACCEPT_TIMEOUT_MS,
): Promise<PhoneCalendarTooling | null> {
  if (!resolveCalendarTooling) {
    return null;
  }

  try {
    const tooling = await Promise.race([
      resolveCalendarTooling(callObjective),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    return tooling;
  } catch (error: unknown) {
    logSipWebhookEvent("openai_sip_calendar_resolve_failed", {
      errorType:
        error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return null;
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    throw new RangeError("Webhook body is too large.");
  }

  const body = await request.text();

  if (new TextEncoder().encode(body).byteLength > MAX_WEBHOOK_BYTES) {
    throw new RangeError("Webhook body is too large.");
  }

  return body;
}

export function extractSipHeader(
  headers: RealtimeCallIncomingWebhookEvent.Data.SipHeader[],
  name: string,
): string | null {
  const header = headers.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );

  return header?.value ?? null;
}

export function buildPhoneSessionConfig(
  callObjective: string,
  calendarTooling: PhoneCalendarTooling | null = null,
): CallAcceptParams {
  const tools = [];

  if (calendarTooling) {
    tools.push(buildGoogleCalendarReadTool(calendarTooling.accessToken));

    if (
      calendarTooling.allowWrites &&
      objectiveAllowsCalendarWrites(callObjective)
    ) {
      tools.push(...buildGoogleCalendarWriteTools());
    }
  }

  return {
    type: "realtime",
    model: REALTIME_MODEL,
    output_modalities: ["audio"],
    instructions: [
      "As soon as this telephone call connects, speak immediately.",
      "Do not wait for the caller to talk first.",
      buildPhoneCallInstructions(callObjective, {
        calendarEnabled: calendarTooling !== null,
        calendarWritesEnabled:
          calendarTooling?.allowWrites === true &&
          objectiveAllowsCalendarWrites(callObjective),
      }),
    ].join("\n\n"),
    max_output_tokens: 512,
    reasoning: {
      effort: "low",
    },
    ...(tools.length > 0
      ? {
          tool_choice: "auto" as const,
          tools,
        }
      : {}),
    audio: {
      input: {
        turn_detection: {
          type: "server_vad",
          create_response: true,
          interrupt_response: true,
          prefix_padding_ms: 200,
          silence_duration_ms: 350,
          idle_timeout_ms: 8_000,
        },
      },
      output: {
        voice: REALTIME_VOICE,
        speed: 1.05,
      },
    },
  };
}

async function handleCalendarFunctionCall(
  accessToken: string,
  name: string,
  rawArguments: string,
): Promise<string> {
  if (name === "create_calendar_event") {
    const mutation = parseCreateCalendarEventArgs(rawArguments);

    if (!mutation) {
      return JSON.stringify({
        ok: false,
        error:
          "Create rejected. Confirm the exact event details with the caller first.",
      });
    }

    const created = await createGoogleCalendarEvent(accessToken, mutation);

    return JSON.stringify({ ok: true, event: created });
  }

  if (name === "update_calendar_event") {
    const update = parseUpdateCalendarEventArgs(rawArguments);

    if (!update) {
      return JSON.stringify({
        ok: false,
        error:
          "Update rejected. Confirm the exact change with the caller first.",
      });
    }

    const updated = await updateGoogleCalendarEvent(
      accessToken,
      update.eventId,
      update.mutation,
    );

    return JSON.stringify({ ok: true, event: updated });
  }

  return JSON.stringify({ ok: false, error: "Unsupported calendar tool." });
}

export async function monitorPhoneCallTools(
  callId: string,
  apiKey: string,
  projectId: string,
  calendarTooling: PhoneCalendarTooling,
  maxDurationMs: number,
): Promise<void> {
  const response = await fetch(
    `https://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Project": projectId,
        Upgrade: "websocket",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const socket = response.webSocket;

  if (response.status !== 101 || !socket) {
    throw new Error("OpenAI did not open the call control connection.");
  }

  socket.accept();

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      socket.close(1000, "Call monitor timeout");
      resolve();
    }, maxDurationMs);

    const finish = () => {
      clearTimeout(timeout);
      try {
        socket.close(1000, "Call monitor complete");
      } catch {
        // already closed
      }
      resolve();
    };

    socket.addEventListener("message", (event: MessageEvent) => {
      const rawData: unknown = event.data;

      if (typeof rawData !== "string") {
        return;
      }

      void (async () => {
        try {
          const payload: unknown = JSON.parse(rawData);

          if (
            typeof payload !== "object" ||
            payload === null ||
            !("type" in payload)
          ) {
            return;
          }

          if (payload.type === "response.done") {
            // Keep monitoring for later turns.
            return;
          }

          if (payload.type === "error") {
            finish();
            return;
          }

          if (
            payload.type === "response.function_call_arguments.done" &&
            "name" in payload &&
            "arguments" in payload &&
            "call_id" in payload &&
            typeof payload.name === "string" &&
            typeof payload.arguments === "string" &&
            typeof payload.call_id === "string"
          ) {
            const output = await handleCalendarFunctionCall(
              calendarTooling.accessToken,
              payload.name,
              payload.arguments,
            );
            socket.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: payload.call_id,
                  output,
                },
              }),
            );
            socket.send(
              JSON.stringify({
                type: "response.create",
                response: {
                  output_modalities: ["audio"],
                },
              }),
            );
          }
        } catch {
          // Ignore malformed control events and keep the call alive.
        }
      })();
    });
    socket.addEventListener("error", () => {
      finish();
    });
    socket.addEventListener("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio"],
          max_output_tokens: 160,
          instructions: PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS,
        },
      }),
    );
  });
}

export async function openPhoneCallControlSocket(
  callId: string,
  apiKey: string,
  projectId: string,
  attempts = 3,
): Promise<WebSocket> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }

    try {
      const response = await fetch(
        `https://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "OpenAI-Project": projectId,
            Upgrade: "websocket",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const socket = response.webSocket;

      if (response.status === 101 && socket) {
        socket.accept();
        return socket;
      }

      lastError = new Error(
        `OpenAI call control upgrade failed with status ${response.status}.`,
      );
    } catch (error: unknown) {
      lastError =
        error instanceof Error
          ? error
          : new Error("OpenAI call control upgrade failed.");
    }
  }

  throw (
    lastError ?? new Error("OpenAI did not open the call control connection.")
  );
}

function sendInitialGreeting(socket: WebSocket): void {
  socket.send(
    JSON.stringify({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        max_output_tokens: 160,
        instructions: PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS,
      },
    }),
  );
}

export async function requestInitialGreeting(
  callId: string,
  apiKey: string,
  projectId: string,
  maxDurationMs = 5 * 60 * 1_000 + 30_000,
): Promise<void> {
  // Give accept a brief moment to finish attaching media before sideband control.
  await new Promise((resolve) => setTimeout(resolve, 400));

  const socket = await openPhoneCallControlSocket(callId, apiKey, projectId);

  await new Promise<void>((resolve, reject) => {
    let greetingSent = false;
    let greetingDone = false;
    const timeout = setTimeout(() => {
      try {
        socket.close(1000, "Call control timeout");
      } catch {
        // already closed
      }
      if (!greetingDone) {
        reject(new Error("The initial greeting did not finish in time."));
      } else {
        resolve();
      }
    }, maxDurationMs);

    const finishGreeting = (error?: Error) => {
      if (greetingDone) {
        return;
      }

      greetingDone = true;

      if (error) {
        clearTimeout(timeout);
        try {
          socket.close(1000, "Greeting failed");
        } catch {
          // already closed
        }
        reject(error);
        return;
      }

      // Keep the sideband socket open for the life of the call after audio starts.
      logSipWebhookEvent("openai_sip_greeting_done");
    };

    const ensureGreeting = () => {
      if (greetingSent) {
        return;
      }

      greetingSent = true;
      sendInitialGreeting(socket);
    };

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const payload: unknown = JSON.parse(event.data);

        if (
          typeof payload !== "object" ||
          payload === null ||
          !("type" in payload)
        ) {
          return;
        }

        if (
          payload.type === "session.created" ||
          payload.type === "session.updated"
        ) {
          ensureGreeting();
          return;
        }

        if (payload.type === "response.done") {
          finishGreeting();
          return;
        }

        if (payload.type === "error") {
          const message =
            "error" in payload &&
            typeof payload.error === "object" &&
            payload.error !== null &&
            "message" in payload.error &&
            typeof payload.error.message === "string"
              ? payload.error.message
              : "OpenAI reported a greeting control error.";
          finishGreeting(new Error(message));
        }
      } catch {
        // Ignore malformed control events and keep the call alive.
      }
    });
    socket.addEventListener("error", () => {
      if (!greetingDone) {
        finishGreeting(new Error("The OpenAI call control connection failed."));
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.addEventListener("close", () => {
      clearTimeout(timeout);
      if (!greetingDone) {
        reject(new Error("The OpenAI call control connection closed early."));
      } else {
        resolve();
      }
    });

    // Accepted SIP sessions may skip session.created; speak immediately either way.
    ensureGreeting();
    setTimeout(ensureGreeting, 500);
  });
}

export async function handleOpenAIRealtimeWebhook(
  request: Request,
  options: OpenAISipWebhookOptions,
): Promise<Response> {
  logSipWebhookEvent("openai_sip_webhook_hit");

  const hasWebhookIdHeader = request.headers.has("webhook-id");
  const recordDiagnostic = async (
    diagnostic: Parameters<
      NonNullable<OpenAISipWebhookOptions["recordWebhookDiagnostic"]>
    >[0],
  ) => {
    if (!options.recordWebhookDiagnostic) {
      return;
    }

    try {
      await options.recordWebhookDiagnostic(diagnostic);
    } catch (error: unknown) {
      logSipWebhookEvent("openai_sip_diagnostic_record_failed", {
        errorType:
          error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  };

  let rawBody: string;

  try {
    rawBody = await readBoundedBody(request);
  } catch (error) {
    logSipWebhookEvent("openai_sip_webhook_body_invalid", {
      code:
        error instanceof RangeError
          ? "WEBHOOK_TOO_LARGE"
          : "WEBHOOK_BODY_INVALID",
    });
    await recordDiagnostic({
      receivedAt: Date.now(),
      signatureOk: false,
      eventType: null,
      hasWebhookIdHeader,
      hasLeaseHeader: false,
      hasClaimHeader: false,
      sipHeaderCount: 0,
      claimMode: "skipped",
      accepted: false,
      detail:
        error instanceof RangeError
          ? "WEBHOOK_TOO_LARGE"
          : "WEBHOOK_BODY_INVALID",
    });
    return jsonResponse(
      {
        code:
          error instanceof RangeError
            ? "WEBHOOK_TOO_LARGE"
            : "WEBHOOK_BODY_INVALID",
      },
      error instanceof RangeError ? 413 : 400,
    );
  }

  const client = new OpenAI({
    apiKey: options.apiKey,
    project: options.projectId,
    webhookSecret: options.webhookSecret,
    maxRetries: 0,
    timeout: 10_000,
  });
  let event: Awaited<ReturnType<typeof client.webhooks.unwrap>>;

  try {
    event = await client.webhooks.unwrap(rawBody, request.headers);
  } catch (error: unknown) {
    let parsedType: string | null = null;

    try {
      const parsed: unknown = JSON.parse(rawBody);

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        typeof parsed.type === "string"
      ) {
        parsedType = parsed.type;
      }
    } catch {
      // ignore malformed diagnostic body
    }

    logSipWebhookEvent("openai_sip_webhook_signature_invalid", {
      errorType:
        error instanceof Error ? error.constructor.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 160) : null,
      hasWebhookIdHeader,
      hasWebhookSignature: request.headers.has("webhook-signature"),
      parsedType,
    });
    await recordDiagnostic({
      receivedAt: Date.now(),
      signatureOk: false,
      eventType: parsedType,
      hasWebhookIdHeader,
      hasLeaseHeader: false,
      hasClaimHeader: false,
      sipHeaderCount: 0,
      claimMode: "skipped",
      accepted: false,
      detail: "WEBHOOK_SIGNATURE_INVALID",
    });
    return jsonResponse({ code: "WEBHOOK_SIGNATURE_INVALID" }, 400);
  }

  logSipWebhookEvent("openai_sip_webhook_signature_ok", {
    eventType: event.type,
  });

  if (event.type !== "realtime.call.incoming") {
    await recordDiagnostic({
      receivedAt: Date.now(),
      signatureOk: true,
      eventType: event.type,
      hasWebhookIdHeader,
      hasLeaseHeader: false,
      hasClaimHeader: false,
      sipHeaderCount: 0,
      claimMode: "skipped",
      accepted: false,
      detail: "ignored_event_type",
    });
    return jsonResponse({ received: true });
  }

  const leaseId = extractSipHeader(event.data.sip_headers, LEASE_HEADER);
  const claimToken = extractSipHeader(
    event.data.sip_headers,
    CLAIM_TOKEN_HEADER,
  );

  logSipWebhookEvent("openai_sip_webhook_headers", {
    hasLeaseId: Boolean(leaseId),
    hasClaimToken: Boolean(claimToken),
    sipHeaderCount: event.data.sip_headers.length,
    sipHeaderNames: event.data.sip_headers.map((header) => header.name),
  });

  let callObjective: string | null = null;
  let claimMode: "headers" | "sole_active" | "rejected" = "rejected";

  if (leaseId && claimToken) {
    callObjective = await options.claimCallObjective(
      leaseId,
      claimToken,
      event.data.call_id,
    );
    if (callObjective) {
      claimMode = "headers";
    }
  }

  if (!callObjective && options.claimSoleActiveCallObjective) {
    const sole = await options.claimSoleActiveCallObjective(event.data.call_id);

    if (sole) {
      callObjective = sole.callObjective;
      claimMode = "sole_active";
      logSipWebhookEvent("openai_sip_webhook_claim_sole_active", {
        leaseId: sole.leaseId,
      });
    }
  }

  if (!callObjective) {
    logSipWebhookEvent("openai_sip_webhook_claim_rejected", {
      hasLeaseId: Boolean(leaseId),
      hasClaimToken: Boolean(claimToken),
      hasObjective: false,
    });
    await recordDiagnostic({
      receivedAt: Date.now(),
      signatureOk: true,
      eventType: event.type,
      hasWebhookIdHeader,
      hasLeaseHeader: Boolean(leaseId),
      hasClaimHeader: Boolean(claimToken),
      sipHeaderCount: event.data.sip_headers.length,
      claimMode: "rejected",
      accepted: false,
      detail: "claim_rejected",
    });
    await client.realtime.calls.reject(event.data.call_id, {
      status_code: 603,
    });

    return jsonResponse({ received: true, accepted: false });
  }

  logSipWebhookEvent("openai_sip_webhook_claim_ok", { claimMode });

  try {
    logSipWebhookEvent("openai_sip_accept_start", {
      calendarAttached: false,
    });
    await client.realtime.calls.accept(
      event.data.call_id,
      buildPhoneSessionConfig(callObjective, null),
    );
    logSipWebhookEvent("openai_sip_accept_ok", {
      calendarAttached: false,
    });
  } catch (error: unknown) {
    logSipWebhookEvent("openai_sip_accept_failed", {
      errorType:
        error instanceof Error ? error.constructor.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 160) : null,
    });
    await recordDiagnostic({
      receivedAt: Date.now(),
      signatureOk: true,
      eventType: event.type,
      hasWebhookIdHeader,
      hasLeaseHeader: Boolean(leaseId),
      hasClaimHeader: Boolean(claimToken),
      sipHeaderCount: event.data.sip_headers.length,
      claimMode,
      accepted: false,
      detail: "accept_failed",
    });
    throw error;
  }

  await recordDiagnostic({
    receivedAt: Date.now(),
    signatureOk: true,
    eventType: event.type,
    hasWebhookIdHeader,
    hasLeaseHeader: Boolean(leaseId),
    hasClaimHeader: Boolean(claimToken),
    sipHeaderCount: event.data.sip_headers.length,
    claimMode,
    accepted: true,
    detail: "accept_ok_greeting_pending",
  });

  // Best-effort calendar resolve after SIP is already answered (observability only).
  options.waitUntil(
    (async () => {
      logSipWebhookEvent("openai_sip_calendar_resolve_start");
      const calendarTooling = await resolveCalendarToolingForAccept(
        options.resolveCalendarTooling,
        callObjective,
      );
      logSipWebhookEvent("openai_sip_calendar_resolve_end", {
        calendarAttached: calendarTooling !== null,
        calendarWrites: calendarTooling?.allowWrites === true,
        sipAcceptUsesCalendar: false,
      });
    })().catch((error: unknown) => {
      logSipWebhookEvent("openai_sip_calendar_resolve_failed", {
        errorType:
          error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }),
  );

  logSipWebhookEvent("openai_sip_greeting_start");
  options.waitUntil(
    requestInitialGreeting(
      event.data.call_id,
      options.apiKey,
      options.projectId,
    )
      .then(async () => {
        await recordDiagnostic({
          receivedAt: Date.now(),
          signatureOk: true,
          eventType: event.type,
          hasWebhookIdHeader,
          hasLeaseHeader: Boolean(leaseId),
          hasClaimHeader: Boolean(claimToken),
          sipHeaderCount: event.data.sip_headers.length,
          claimMode,
          accepted: true,
          detail: "greeting_ok",
        });
      })
      .catch(async (error: unknown) => {
        console.error(
          JSON.stringify({
            event: "openai_sip_greeting_failed",
            errorType:
              error instanceof Error ? error.constructor.name : "UnknownError",
            errorMessage:
              error instanceof Error ? error.message.slice(0, 160) : null,
          }),
        );
        await recordDiagnostic({
          receivedAt: Date.now(),
          signatureOk: true,
          eventType: event.type,
          hasWebhookIdHeader,
          hasLeaseHeader: Boolean(leaseId),
          hasClaimHeader: Boolean(claimToken),
          sipHeaderCount: event.data.sip_headers.length,
          claimMode,
          accepted: true,
          detail:
            error instanceof Error
              ? `greeting_failed:${error.message.slice(0, 120)}`
              : "greeting_failed",
        });
      }),
  );

  return jsonResponse({ received: true, accepted: true });
}
