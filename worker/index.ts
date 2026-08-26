import runtimeSafetyConfig from "../config/runtime-safety.json";
import {
  OPENAI_API_BASE_URL,
  REALTIME_MODEL,
  REALTIME_SAFETY_IDENTIFIER,
  REALTIME_VOICE,
  openAIRealtimeClientSecretSchema,
} from "../src/lib/realtime-config";
import { runtimeSafetyConfigSchema } from "../src/lib/runtime-safety-schema";
import { evaluateBrowserVoiceLease } from "../src/lib/voice-session-policy";
import { z } from "zod";
import {
  isPreviewAuthorized,
  isPreviewRequestIntentValid,
  requestIntentRejectedResponse,
  unauthorizedResponse,
} from "./auth";
import {
  buildGoogleCalendarAuthorizeUrl,
  exchangeGoogleCalendarAuthorizationCode,
  refreshGoogleCalendarAccessToken,
} from "./google-calendar";
import { handleOpenAIRealtimeWebhook } from "./openai-sip";
import { dispositionPhoneCreateFailure } from "./phone-call-lifecycle";
import { readLeaseIdFromRequest } from "./request-body";
import {
  buildTwilioPilotCallHistoryUpdate,
  createTwilioPilotCall,
  findRecoverableTwilioPilotCall,
  getTwilioPilotCall,
  isTerminalTwilioCallStatus,
  normalizeNorthAmericanDestination,
  readPhonePilotStartRequest,
  stopTwilioPilotCall,
  type TwilioCall,
  type TwilioCredentials,
} from "./phone-pilot";
import {
  phoneDialDncError,
  resolvePhoneDialDestination,
  type PhoneContact,
  type PhoneDialResolutionError,
} from "./phone-destination";
import { type VoiceSafetyPolicy, type VoiceSafetyScope } from "./safety-policy";
import { isConfiguredSecret } from "./secrets";
import {
  PHONE_CONTACT_MAX,
  VoiceSafetyLedger,
  type PhoneCallHistoryRecord,
} from "./voice-safety-ledger";

export { VoiceSafetyLedger };

const safety = runtimeSafetyConfigSchema.parse(runtimeSafetyConfig);

const BROWSER_POLICY: VoiceSafetyPolicy = {
  maxSessionMs: safety.limits.maxCallMinutes * 60 * 1_000,
  maxConcurrentSessions: safety.limits.maxConcurrentSessions,
  maxDailySessions: safety.limits.maxDailyPaidTests,
  maxLifetimeSessions: null,
  maxLifetimeReservedUsdCents: null,
  reservedUsdCentsPerSession: 0,
};

const PHONE_POLICY: VoiceSafetyPolicy = {
  maxSessionMs: safety.phonePilot.maxCallMinutes * 60 * 1_000,
  maxConcurrentSessions: safety.phonePilot.maxConcurrentCalls,
  maxDailySessions: safety.phonePilot.maxCalls,
  maxLifetimeSessions: safety.phonePilot.maxCalls,
  maxLifetimeReservedUsdCents: Math.round(
    safety.phonePilot.maxEstimatedSpendUsd * 100,
  ),
  reservedUsdCentsPerSession: Math.round(
    safety.phonePilot.reservedUsdPerCall * 100,
  ),
};

const phoneContactPayloadSchema = z
  .object({
    id: z.string().trim().min(1).max(64).optional(),
    displayName: z.string().trim().min(1).max(80),
    phoneNumber: z.string().trim().min(1).max(32),
  })
  .strict();

function getSafetyLedger(env: Env): DurableObjectStub<VoiceSafetyLedger> {
  return env.VOICE_SAFETY_LEDGER.getByName("preview-paid-voice-v1");
}

async function getUsage(env: Env, scope: VoiceSafetyScope) {
  return getSafetyLedger(env).getStatus(scope);
}

async function listPhoneContacts(env: Env): Promise<PhoneContact[]> {
  const ledger = getSafetyLedger(env);
  const seedNumber = normalizeNorthAmericanDestination(
    env.TWILIO_VERIFIED_NUMBER?.trim() ?? "",
  );

  if (seedNumber) {
    await ledger.ensureSeedContact({
      id: "seed-primary",
      displayName: "Primary",
      e164: seedNumber,
    });
  }

  return ledger.listContacts();
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function logWorkerError(event: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event,
      errorType:
        error instanceof Error ? error.constructor.name : "UnknownError",
    }),
  );
}

function getTwilioCredentials(env: Env): TwilioCredentials | null {
  const values = {
    accountSid: env.TWILIO_ACCOUNT_SID?.trim() ?? "",
    apiKeySid: env.TWILIO_API_KEY_SID?.trim() ?? "",
    apiKeySecret: env.TWILIO_API_KEY_SECRET?.trim() ?? "",
    fromNumber: env.TWILIO_FROM_NUMBER?.trim() ?? "",
    verifiedDestinationNumber: env.TWILIO_VERIFIED_NUMBER?.trim() ?? "",
  };

  return Object.values(values).every(isConfiguredSecret) ? values : null;
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  try {
    const declaredLength = Number(request.headers.get("content-length"));

    if (Number.isFinite(declaredLength) && declaredLength > 4_096) {
      return null;
    }

    const rawBody = await request.text();

    if (rawBody.trim().length === 0) {
      return null;
    }

    if (new TextEncoder().encode(rawBody).byteLength > 4_096) {
      return null;
    }

    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function phoneDialErrorStatus(code: PhoneDialResolutionError["code"]): number {
  switch (code) {
    case "PHONE_DIAL_REQUEST_INVALID":
      return 400;
    case "PHONE_DNC_BLOCKED":
      return 403;
    case "PHONE_CONTACT_NOT_FOUND":
      return 404;
    case "PHONE_ATTESTATION_REQUIRED":
      return 403;
    case "PHONE_CONTACT_LIMIT":
      return 409;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

function pathIdAfterPrefix(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const encodedId = pathname.slice(prefix.length);

  if (!encodedId || encodedId.includes("/")) {
    return null;
  }

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

function getGoogleCalendarOAuthConfig(env: Env, requestUrl: URL) {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${requestUrl.origin}/api/google/oauth/callback`,
  };
}

async function resolvePhoneCalendarTooling(
  env: Env,
  _callObjective: string,
): Promise<{ accessToken: string; allowWrites: boolean } | null> {
  try {
    if (!safety.phonePilot.calendar.enabled) {
      return null;
    }

    const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? "";
    const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "";

    if (!clientId || !clientSecret) {
      return null;
    }

    const ledger = getSafetyLedger(env);
    const stored = await ledger.getGoogleOAuthTokens();

    if (!stored) {
      return null;
    }

    const freshEnough =
      stored.accessToken &&
      stored.accessExpiresAt &&
      stored.accessExpiresAt > Date.now() + 60_000;

    if (freshEnough && stored.accessToken) {
      return {
        accessToken: stored.accessToken,
        allowWrites: safety.phonePilot.calendar.allowWrites,
      };
    }

    const refreshed = await refreshGoogleCalendarAccessToken(
      { clientId, clientSecret },
      stored.refreshToken,
    );
    await ledger.saveGoogleOAuthTokens(refreshed);

    if (!refreshed.accessToken) {
      return null;
    }

    return {
      accessToken: refreshed.accessToken,
      allowWrites: safety.phonePilot.calendar.allowWrites,
    };
  } catch (error: unknown) {
    logWorkerError("phone_calendar_tooling_resolve_failed", error);
    return null;
  }
}
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function googleOAuthHtmlPage(
  title: string,
  bodyHtml: string,
  status = 200,
): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; max-width: 40rem; line-height: 1.45; color: #202033; background: #f8f8fc; }
      code, pre { background: #ececf4; padding: 0.15rem 0.35rem; border-radius: 4px; word-break: break-all; }
      pre { padding: 0.75rem; overflow-x: auto; }
      a.button { display: inline-block; margin-top: 1rem; padding: 0.65rem 1rem; background: #4338ca; color: white; text-decoration: none; border-radius: 6px; }
      .ok { color: #166534; }
      .bad { color: #991b1b; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${bodyHtml}
  </body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

async function handleGoogleOAuthSetup(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const config = getGoogleCalendarOAuthConfig(env, url);
  const connected = await getSafetyLedger(env).hasGoogleCalendarConnection();
  const redirectUri = `${url.origin}/api/google/oauth/callback`;

  if (!config) {
    return googleOAuthHtmlPage(
      "Google Calendar setup",
      `<p class="bad">Worker secrets <code>GOOGLE_CALENDAR_CLIENT_ID</code> and <code>GOOGLE_CALENDAR_CLIENT_SECRET</code> are missing.</p>`,
      503,
    );
  }

  return googleOAuthHtmlPage(
    "Google Calendar setup",
    `
      <p>Status: ${
        connected
          ? '<strong class="ok">connected</strong>'
          : '<strong class="bad">not connected</strong>'
      }</p>
      <p>Connect the operator Google Calendar account. If <code>GOOGLE_CALENDAR_LOGIN_HINT</code> is set on the Worker, Google will preselect that account.</p>
      <p>If Google shows <code>redirect_uri_mismatch</code>, add this exact Authorized redirect URI in Google Cloud Console for this OAuth client:</p>
      <pre>${escapeHtml(redirectUri)}</pre>
      <ol>
        <li>Open Google Cloud Console → APIs &amp; Services → Credentials</li>
        <li>Open the OAuth 2.0 Client ID used by this Worker</li>
        <li>Under <strong>Authorized redirect URIs</strong>, add the URI above (exact match)</li>
        <li>Save, wait ~1 minute, then click Connect and approve as the operator account</li>
      </ol>
      <p><a class="button" href="/api/google/oauth/start">Connect Google Calendar</a></p>
    `,
  );
}

async function handleGoogleOAuthCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const config = getGoogleCalendarOAuthConfig(env, url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return googleOAuthHtmlPage(
      "Google Calendar authorization failed",
      `<p class="bad">Google returned <code>${escapeHtml(oauthError)}</code>.</p>
       <p>If this is <code>redirect_uri_mismatch</code>, register
       <code>${escapeHtml(`${url.origin}/api/google/oauth/callback`)}</code> on the OAuth client, then retry from
       <a href="/api/google/oauth/setup">setup</a>.</p>`,
      400,
    );
  }

  if (!config || !code || !state) {
    return googleOAuthHtmlPage(
      "Google Calendar authorization failed",
      `<p class="bad">Missing authorization code or state.</p>
       <p><a href="/api/google/oauth/setup">Back to setup</a></p>`,
      400,
    );
  }

  const ledger = getSafetyLedger(env);
  const validState = await ledger.consumeGoogleOAuthState(state);

  if (!validState) {
    return googleOAuthHtmlPage(
      "Google Calendar authorization expired",
      `<p class="bad">The one-time state token expired or was already used.</p>
       <p><a href="/api/google/oauth/setup">Start again</a></p>`,
      400,
    );
  }

  try {
    const tokens = await exchangeGoogleCalendarAuthorizationCode(config, code);
    await ledger.saveGoogleOAuthTokens(tokens);

    return googleOAuthHtmlPage(
      "Google Calendar connected",
      `<p class="ok">The operator's assistant can use Calendar now.</p>
       <p>You can close this tab.</p>`,
    );
  } catch {
    return googleOAuthHtmlPage(
      "Google Calendar authorization could not be saved",
      `<p class="bad">Token exchange failed. Confirm the client ID/secret match the Console client that has this redirect URI.</p>
       <p><a href="/api/google/oauth/setup">Back to setup</a></p>`,
      502,
    );
  }
}

async function safetyStatus(env: Env): Promise<Response> {
  const [browserUsage, phoneUsage, calendarConnected] = await Promise.all([
    getUsage(env, "browser"),
    getUsage(env, "phone"),
    getSafetyLedger(env).hasGoogleCalendarConnection(),
  ]);

  return jsonResponse({
    ...safety,
    phonePilot: {
      ...safety.phonePilot,
      calendar: {
        ...safety.phonePilot.calendar,
        connected: calendarConnected,
      },
    },
    apiKeyConfigured: isConfiguredSecret(env.OPENAI_API_KEY),
    activeSessions: browserUsage.activeSessions,
    paidTestsToday: browserUsage.dailySessions,
    realtimeModel: REALTIME_MODEL,
    phonePilotUsage: {
      activeCalls: phoneUsage.activeSessions,
      lifetimeCalls: phoneUsage.lifetimeSessions,
      estimatedReservedSpendUsd: phoneUsage.reservedUsdCents / 100,
    },
  });
}

async function createClientSecret(env: Env): Promise<Response> {
  const safetyDecision = evaluateBrowserVoiceLease({
    safety,
    snapshot: {
      activeLeaseCount: 0,
      dailyPaidTests: 0,
      nowMs: Date.now(),
    },
  });

  if (!safetyDecision.allowed) {
    return jsonResponse(
      {
        code: safetyDecision.code,
        message: safetyDecision.message,
      },
      safetyDecision.status,
    );
  }

  if (!isConfiguredSecret(env.OPENAI_API_KEY)) {
    return jsonResponse(
      {
        code: "OPENAI_KEY_MISSING",
        message: "The Worker does not have an OpenAI API key.",
      },
      503,
    );
  }

  const ledger = getSafetyLedger(env);
  const reservation = await ledger.reserveSession("browser", BROWSER_POLICY);

  if (!reservation.allowed) {
    return jsonResponse(
      {
        code: reservation.code,
        message: reservation.message,
      },
      429,
    );
  }

  try {
    const openAIResponse = await fetch(
      `${OPENAI_API_BASE_URL}/realtime/client_secrets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": REALTIME_SAFETY_IDENTIFIER,
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            audio: {
              output: {
                voice: REALTIME_VOICE,
              },
            },
          },
        }),
      },
    );
    const payload: unknown = await openAIResponse.json();

    if (!openAIResponse.ok) {
      await ledger.cancelSession(reservation.leaseId, "browser");

      return jsonResponse(
        {
          code: "OPENAI_CLIENT_SECRET_ERROR",
          message: "OpenAI did not create a browser voice credential.",
        },
        openAIResponse.status,
      );
    }

    const clientSecret = openAIRealtimeClientSecretSchema.safeParse(payload);

    if (!clientSecret.success) {
      await ledger.cancelSession(reservation.leaseId, "browser");

      return jsonResponse(
        {
          code: "OPENAI_CLIENT_SECRET_INVALID",
          message: "OpenAI returned an unexpected browser credential format.",
        },
        502,
      );
    }

    return jsonResponse({
      leaseId: reservation.leaseId,
      expiresAt: reservation.expiresAt,
      clientSecret: clientSecret.data.value,
    });
  } catch (error) {
    await ledger.cancelSession(reservation.leaseId, "browser");
    throw error;
  }
}

async function releaseLease(request: Request, env: Env): Promise<Response> {
  const leaseId = await readLeaseIdFromRequest(request);

  if (!leaseId) {
    return jsonResponse({ code: "INVALID_LEASE" }, 400);
  }

  const released = await getSafetyLedger(env).releaseSession(
    leaseId,
    "browser",
  );

  return jsonResponse({ released });
}

async function phoneContactsList(env: Env): Promise<Response> {
  return jsonResponse({ contacts: await listPhoneContacts(env) });
}

async function phoneContactUpsert(
  request: Request,
  env: Env,
): Promise<Response> {
  const payload = await readBoundedJson(request);
  const parsed = phoneContactPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return jsonResponse(
      {
        code: "PHONE_CONTACT_INVALID",
        message: "Provide displayName and a valid North American phoneNumber.",
      },
      400,
    );
  }

  const e164 = normalizeNorthAmericanDestination(parsed.data.phoneNumber);

  if (!e164) {
    return jsonResponse(
      {
        code: "PHONE_CONTACT_INVALID",
        message: "Enter a valid US or Canada phone number.",
      },
      400,
    );
  }

  const contacts = await listPhoneContacts(env);
  const id = parsed.data.id ?? crypto.randomUUID();
  const existingById = contacts.some((contact) => contact.id === id);
  const existingByNumber = contacts.find(
    (contact) => contact.e164 === e164 && contact.id !== id,
  );

  if (existingByNumber) {
    return jsonResponse(
      {
        code: "PHONE_CONTACT_EXISTS",
        message: "That phone number is already saved.",
      },
      409,
    );
  }

  if (!existingById && contacts.length >= PHONE_CONTACT_MAX) {
    return jsonResponse(
      {
        code: "PHONE_CONTACT_LIMIT",
        message: `You can save at most ${PHONE_CONTACT_MAX} people.`,
      },
      409,
    );
  }

  const contact = {
    id,
    displayName: parsed.data.displayName,
    e164,
  };
  await getSafetyLedger(env).upsertContact(contact);

  return jsonResponse({ contact }, existingById ? 200 : 201);
}

async function phoneContactDelete(env: Env, id: string): Promise<Response> {
  const deleted = await getSafetyLedger(env).deleteContact(id);

  if (!deleted) {
    return jsonResponse(
      {
        code: "PHONE_CONTACT_NOT_FOUND",
        message: "That person is not in your saved contacts.",
      },
      404,
    );
  }

  return jsonResponse({ deleted: true });
}

async function phoneRecentsList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");

  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
    return jsonResponse(
      {
        code: "PHONE_RECENTS_LIMIT_INVALID",
        message: "The recents limit must be a positive integer.",
      },
      400,
    );
  }

  const recents: PhoneCallHistoryRecord[] = await getSafetyLedger(
    env,
  ).listCallHistory(rawLimit === null ? undefined : Number(rawLimit));

  return jsonResponse({ recents });
}

async function phoneRecentDetail(env: Env, id: string): Promise<Response> {
  const recent = await getSafetyLedger(env).getCallHistory(id);

  if (!recent) {
    return jsonResponse(
      {
        code: "PHONE_RECENT_NOT_FOUND",
        message: "That recent call was not found.",
      },
      404,
    );
  }

  return jsonResponse({ recent });
}

async function startPhonePilot(request: Request, env: Env): Promise<Response> {
  if (!safety.phonePilot.enabled) {
    return jsonResponse(
      {
        code: "PHONE_PILOT_DISABLED",
        message:
          "The phone connector is installed, but outbound calling is locked.",
      },
      403,
    );
  }

  if (
    !safety.voiceEnabled ||
    !safety.platformHardSpendLimit.confirmed ||
    safety.platformHardSpendLimit.monthlyUsd === null
  ) {
    return jsonResponse(
      {
        code: "VOICE_SAFETY_GATE",
        message: "Phone calling is blocked by the paid voice safety gate.",
      },
      403,
    );
  }

  const credentials = getTwilioCredentials(env);
  const projectId = env.OPENAI_PROJECT_ID?.trim() ?? "";

  if (!credentials || !isConfiguredSecret(projectId)) {
    return jsonResponse(
      {
        code: "PHONE_CONFIGURATION_MISSING",
        message: "The Worker does not have the complete phone configuration.",
      },
      503,
    );
  }

  const startRequest = await readPhonePilotStartRequest(request, credentials);

  if (!startRequest) {
    return jsonResponse(
      {
        code: "PHONE_DIAL_REQUEST_INVALID",
        message: "Provide a valid phone call request body under 4096 bytes.",
      },
      400,
    );
  }

  const ledger = getSafetyLedger(env);
  let resolvedDial: {
    destinationNumber: string;
    callObjective: string;
    contactId: string | null;
    displayName: string;
    saveContact: boolean;
  } | null =
    startRequest.kind === "self-test"
      ? {
          destinationNumber: startRequest.dialRequest.destinationNumber,
          callObjective: startRequest.dialRequest.callObjective,
          contactId: null,
          displayName: "Primary",
          saveContact: false,
        }
      : null;

  const dnc = new Set(await ledger.listDncE164());

  if (startRequest.kind === "json") {
    const contacts = await listPhoneContacts(env);
    const resolved = resolvePhoneDialDestination({
      payload: startRequest.payload,
      contacts,
      dncE164: dnc,
      maxContacts: PHONE_CONTACT_MAX,
    });

    if (!resolved.ok) {
      return jsonResponse(
        resolved.error,
        phoneDialErrorStatus(resolved.error.code),
      );
    }

    resolvedDial = resolved.value;
  } else if (resolvedDial) {
    const dncError = phoneDialDncError(resolvedDial.destinationNumber, dnc);
    if (dncError) {
      return jsonResponse(dncError, phoneDialErrorStatus(dncError.code));
    }
  }

  if (!resolvedDial) {
    return jsonResponse({ code: "PHONE_DIAL_REQUEST_INVALID" }, 400);
  }

  const reservation = await ledger.reserveSession("phone", PHONE_POLICY);

  if (!reservation.allowed) {
    return jsonResponse(
      {
        code: reservation.code,
        message: reservation.message,
      },
      429,
    );
  }

  let createdCall: TwilioCall | null = null;
  let providerCreateStarted = false;
  const callStartedAt = Date.now();
  const savedContact = resolvedDial.saveContact
    ? {
        id: crypto.randomUUID(),
        displayName: resolvedDial.displayName,
        e164: resolvedDial.destinationNumber,
      }
    : null;

  try {
    const claimToken = await ledger.preparePhoneCall(
      reservation.leaseId,
      resolvedDial.callObjective,
    );

    if (!claimToken) {
      throw new Error("The call objective could not be attached to its lease.");
    }

    providerCreateStarted = await ledger.beginPhoneProviderCreate(
      reservation.leaseId,
    );

    if (!providerCreateStarted) {
      throw new Error("The protected provider attempt could not be started.");
    }

    await ledger.recordCallHistory({
      leaseId: reservation.leaseId,
      contactId: savedContact?.id ?? resolvedDial.contactId,
      displayName: resolvedDial.displayName,
      e164: resolvedDial.destinationNumber,
      objective: resolvedDial.callObjective,
      status: "create-pending",
      outcome: "starting",
      startedAt: callStartedAt,
      providerCallSid: null,
    });

    createdCall = await createTwilioPilotCall(
      credentials,
      resolvedDial.destinationNumber,
      projectId,
      reservation.leaseId,
      claimToken,
      safety.phonePilot.maxCallMinutes * 60,
    );
    const attached = await ledger.attachPhoneCall(
      reservation.leaseId,
      createdCall.sid,
      createdCall.status,
    );

    if (!attached) {
      throw new Error(
        "The phone call could not be attached to its safety lease.",
      );
    }

    await ledger.recordCallHistory({
      leaseId: reservation.leaseId,
      contactId: savedContact?.id ?? resolvedDial.contactId,
      displayName: resolvedDial.displayName,
      e164: resolvedDial.destinationNumber,
      objective: resolvedDial.callObjective,
      status: createdCall.status,
      outcome: "started",
      startedAt: callStartedAt,
      providerCallSid: createdCall.sid,
    });

    if (savedContact) {
      try {
        await ledger.upsertContact(savedContact);
      } catch (error) {
        logWorkerError("phone_contact_save_failed", error);
      }
    }

    return jsonResponse(
      {
        leaseId: reservation.leaseId,
        expiresAt: reservation.expiresAt,
        status: createdCall.status,
        maxCallSeconds: safety.phonePilot.maxCallMinutes * 60,
      },
      201,
    );
  } catch (error) {
    let providerStopConfirmed = false;

    if (createdCall) {
      try {
        const stoppedCall = await stopTwilioPilotCall(
          credentials,
          createdCall.sid,
        );

        if (isTerminalTwilioCallStatus(stoppedCall.status)) {
          providerStopConfirmed = await ledger.markPhoneCallTerminal(
            reservation.leaseId,
            stoppedCall.status,
          );
        }
      } catch (stopError) {
        logWorkerError("twilio_phone_cleanup_failed", stopError);
      }
    }

    const failureDisposition = dispositionPhoneCreateFailure({
      providerCreateStarted,
      providerStopConfirmed,
    });

    switch (failureDisposition) {
      case "provider_unknown":
        await ledger.markPhoneProviderUnknown(reservation.leaseId);
        break;
      case "cancel":
        await ledger.cancelSession(reservation.leaseId, "phone");
        break;
      case "already_terminal":
        break;
      default: {
        const _exhaustive: never = failureDisposition;
        void _exhaustive;
      }
    }
    logWorkerError("twilio_phone_start_failed", error);

    return jsonResponse(
      {
        code: "PHONE_START_FAILED",
        message: "The protected phone call could not be started.",
      },
      502,
    );
  }
}

async function phonePilotStatus(request: Request, env: Env): Promise<Response> {
  const leaseId = await readLeaseIdFromRequest(request);

  if (!leaseId) {
    return jsonResponse({ code: "INVALID_LEASE" }, 400);
  }

  const credentials = getTwilioCredentials(env);

  if (!credentials) {
    return jsonResponse({ code: "PHONE_CONFIGURATION_MISSING" }, 503);
  }

  const ledger = getSafetyLedger(env);
  const record = await ledger.getPhoneCall(leaseId);

  if (!record) {
    return jsonResponse({ code: "PHONE_CALL_NOT_FOUND" }, 404);
  }

  try {
    const call = await getTwilioPilotCall(credentials, record.callSid);
    const terminal = isTerminalTwilioCallStatus(call.status);

    if (terminal) {
      await ledger.markPhoneCallTerminal(leaseId, call.status);
    } else {
      await ledger.updatePhoneCallStatus(leaseId, call.status);
    }

    await ledger.updateCallHistory(
      leaseId,
      buildTwilioPilotCallHistoryUpdate(call, record.callSid),
    );

    return jsonResponse({
      status: call.status,
      durationSeconds: call.duration ? Number(call.duration) : null,
      priceUsd: call.price ? Math.abs(Number(call.price)) : null,
      priceUnit: call.price_unit ?? null,
      terminal,
    });
  } catch (error) {
    logWorkerError("twilio_phone_status_failed", error);

    return jsonResponse({ code: "PHONE_STATUS_FAILED" }, 502);
  }
}

async function stopPhonePilot(request: Request, env: Env): Promise<Response> {
  const leaseId = await readLeaseIdFromRequest(request);

  if (!leaseId) {
    return jsonResponse({ code: "INVALID_LEASE" }, 400);
  }

  const credentials = getTwilioCredentials(env);

  if (!credentials) {
    return jsonResponse({ code: "PHONE_CONFIGURATION_MISSING" }, 503);
  }

  const ledger = getSafetyLedger(env);
  const record = await ledger.getPhoneCall(leaseId);

  if (!record) {
    return jsonResponse({ code: "PHONE_CALL_NOT_FOUND" }, 404);
  }

  try {
    const stopStarted = await ledger.beginPhoneCallStop(leaseId);

    if (!stopStarted) {
      return jsonResponse(
        {
          code: "PHONE_STOP_NOT_AUTHORIZED",
          message:
            "The carrier call is not in a state that can be stopped by this lease.",
        },
        409,
      );
    }

    const call = await stopTwilioPilotCall(credentials, record.callSid);
    const terminal = isTerminalTwilioCallStatus(call.status);

    if (terminal) {
      await ledger.markPhoneCallTerminal(leaseId, call.status);
    } else {
      await ledger.updatePhoneCallStatus(leaseId, call.status);
    }

    await ledger.updateCallHistory(
      leaseId,
      buildTwilioPilotCallHistoryUpdate(call, record.callSid, {
        terminal: "stopped",
        nonTerminal: "stopping",
      }),
    );

    return jsonResponse({ stopped: terminal, status: call.status });
  } catch (error) {
    logWorkerError("twilio_phone_stop_failed", error);

    return jsonResponse(
      {
        code: "PHONE_STOP_FAILED",
        message: `Twilio did not confirm the stop. The ${safety.phonePilot.maxCallMinutes}-minute carrier limit remains active.`,
      },
      502,
    );
  }
}

async function currentPhonePilot(env: Env): Promise<Response> {
  const ledger = getSafetyLedger(env);
  let current = await ledger.getCurrentPhoneCall();

  if (!current) {
    return jsonResponse({ call: null });
  }

  const credentials = getTwilioCredentials(env);

  if (credentials && current.callSid) {
    try {
      const call = await getTwilioPilotCall(credentials, current.callSid);

      if (isTerminalTwilioCallStatus(call.status)) {
        await ledger.markPhoneCallTerminal(current.leaseId, call.status);
        await ledger.updateCallHistory(
          current.leaseId,
          buildTwilioPilotCallHistoryUpdate(call, current.callSid),
        );

        return jsonResponse({ call: null });
      }

      await ledger.updatePhoneCallStatus(current.leaseId, call.status);
      await ledger.updateCallHistory(
        current.leaseId,
        buildTwilioPilotCallHistoryUpdate(call, current.callSid),
      );
      current = {
        ...current,
        status: call.status,
      };
    } catch (error) {
      logWorkerError("twilio_phone_current_reconcile_failed", error);
    }
  }

  if (credentials && !current.callSid) {
    try {
      const recoveryDestination =
        current.attemptedDestinationNumber ??
        credentials.verifiedDestinationNumber;
      const recovered = await findRecoverableTwilioPilotCall(
        credentials,
        recoveryDestination,
        current.expiresAt - safety.phonePilot.maxCallMinutes * 60 * 1_000,
      );

      if (
        recovered &&
        (await ledger.attachPhoneCall(
          current.leaseId,
          recovered.sid,
          recovered.status,
        ))
      ) {
        if (isTerminalTwilioCallStatus(recovered.status)) {
          await ledger.markPhoneCallTerminal(current.leaseId, recovered.status);
          await ledger.updateCallHistory(
            current.leaseId,
            buildTwilioPilotCallHistoryUpdate(recovered, recovered.sid),
          );

          return jsonResponse({ call: null });
        }

        await ledger.updateCallHistory(
          current.leaseId,
          buildTwilioPilotCallHistoryUpdate(recovered, recovered.sid),
        );
        current = {
          ...current,
          callSid: recovered.sid,
          status: recovered.status,
        };
      }
    } catch (error) {
      logWorkerError("twilio_phone_current_recovery_failed", error);
    }
  }

  return jsonResponse({
    call: {
      leaseId: current.leaseId,
      expiresAt: current.expiresAt,
      status: current.status ?? current.lifecycleState.replaceAll("_", "-"),
      maxCallSeconds: safety.phonePilot.maxCallMinutes * 60,
    },
  });
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/runtime-safety" && request.method === "GET") {
    return safetyStatus(env);
  }

  if (
    url.pathname === "/api/realtime/client-secret" &&
    request.method === "POST"
  ) {
    return createClientSecret(env);
  }

  if (url.pathname === "/api/realtime/release" && request.method === "POST") {
    return releaseLease(request, env);
  }

  if (url.pathname === "/api/phone-pilot/start" && request.method === "POST") {
    return startPhonePilot(request, env);
  }

  if (url.pathname === "/api/phone-pilot/contacts") {
    if (request.method === "GET") {
      return phoneContactsList(env);
    }

    if (request.method === "POST") {
      return phoneContactUpsert(request, env);
    }
  }

  const contactId = pathIdAfterPrefix(
    url.pathname,
    "/api/phone-pilot/contacts/",
  );

  if (contactId && request.method === "DELETE") {
    return phoneContactDelete(env, contactId);
  }

  if (url.pathname === "/api/phone-pilot/recents" && request.method === "GET") {
    return phoneRecentsList(request, env);
  }

  const recentId = pathIdAfterPrefix(url.pathname, "/api/phone-pilot/recents/");

  if (recentId && request.method === "GET") {
    return phoneRecentDetail(env, recentId);
  }

  if (url.pathname === "/api/phone-pilot/current" && request.method === "GET") {
    return currentPhonePilot(env);
  }

  if (
    url.pathname === "/api/phone-pilot/sip-diagnostics" &&
    request.method === "GET"
  ) {
    const diagnostics =
      await getSafetyLedger(env).listSipWebhookDiagnostics(10);
    return jsonResponse({ diagnostics });
  }

  if (url.pathname === "/api/phone-pilot/status" && request.method === "POST") {
    return phonePilotStatus(request, env);
  }

  if (url.pathname === "/api/phone-pilot/stop" && request.method === "POST") {
    return stopPhonePilot(request, env);
  }

  if (url.pathname === "/api/google/oauth/setup" && request.method === "GET") {
    return handleGoogleOAuthSetup(request, env);
  }

  if (url.pathname === "/api/google/oauth/start" && request.method === "GET") {
    const config = getGoogleCalendarOAuthConfig(env, url);

    if (!config) {
      return jsonResponse(
        { code: "GOOGLE_CALENDAR_CONFIGURATION_MISSING" },
        503,
      );
    }

    const state = await getSafetyLedger(env).createGoogleOAuthState();
    return Response.redirect(
      buildGoogleCalendarAuthorizeUrl(
        config,
        state,
        env.GOOGLE_CALENDAR_LOGIN_HINT,
      ),
      302,
    );
  }

  if (
    url.pathname === "/api/google/oauth/disconnect" &&
    request.method === "POST"
  ) {
    const cleared = await getSafetyLedger(env).clearGoogleOAuthTokens();

    return jsonResponse({ disconnected: cleared });
  }

  if (url.pathname.startsWith("/api/")) {
    return jsonResponse({ code: "NOT_FOUND" }, 404);
  }

  const assetResponse = await env.ASSETS.fetch(request);
  const headers = new Headers(assetResponse.headers);
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow");

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/openai/realtime-webhook") {
      if (request.method !== "POST") {
        return jsonResponse({ code: "METHOD_NOT_ALLOWED" }, 405);
      }

      if (
        !isConfiguredSecret(env.OPENAI_API_KEY) ||
        !isConfiguredSecret(env.OPENAI_PROJECT_ID) ||
        !isConfiguredSecret(env.OPENAI_WEBHOOK_SECRET)
      ) {
        return jsonResponse({ code: "OPENAI_SIP_CONFIGURATION_MISSING" }, 503);
      }

      return handleOpenAIRealtimeWebhook(request, {
        apiKey: env.OPENAI_API_KEY,
        projectId: env.OPENAI_PROJECT_ID,
        webhookSecret: env.OPENAI_WEBHOOK_SECRET,
        claimCallObjective: (leaseId, claimToken, openAiCallId) =>
          getSafetyLedger(env).claimPhoneCallObjective(
            leaseId,
            claimToken,
            openAiCallId,
          ),
        claimSoleActiveCallObjective: (openAiCallId) =>
          getSafetyLedger(env).claimSoleActivePhoneCallObjective(openAiCallId),
        recordWebhookDiagnostic: (diagnostic) =>
          getSafetyLedger(env).recordSipWebhookDiagnostic(diagnostic),
        resolveCalendarTooling: (callObjective) =>
          resolvePhoneCalendarTooling(env, callObjective),
        waitUntil: (promise) => ctx.waitUntil(promise),
      });
    }

    if (
      url.pathname === "/api/google/oauth/callback" &&
      request.method === "GET"
    ) {
      return handleGoogleOAuthCallback(request, env);
    }

    if (!isConfiguredSecret(env.PREVIEW_PASSWORD)) {
      return new Response("Preview authentication is not configured.", {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }

    if (!(await isPreviewAuthorized(request, env.PREVIEW_PASSWORD))) {
      return unauthorizedResponse();
    }

    if (!isPreviewRequestIntentValid(request)) {
      return requestIntentRejectedResponse();
    }

    return routeRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
