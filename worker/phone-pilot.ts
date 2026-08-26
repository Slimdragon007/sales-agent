import { z } from "zod";

const TWILIO_API_BASE_URL = "https://api.twilio.com/2010-04-01";

const twilioCallSchema = z.object({
  sid: z.string().regex(/^CA[0-9a-fA-F]{32}$/),
  status: z.string().min(1),
  duration: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  price_unit: z.string().nullable().optional(),
});

export type TwilioCall = z.infer<typeof twilioCallSchema>;

const twilioCallListSchema = z.object({
  calls: z.array(
    twilioCallSchema.extend({
      to: z.string().optional(),
      from: z.string().optional(),
      date_created: z.string().optional(),
    }),
  ),
});

export type TwilioCredentials = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  fromNumber: string;
  verifiedDestinationNumber: string;
};

export type PhoneDialRequest = {
  destinationNumber: string;
  callObjective: string;
};

export type PhonePilotStartRequest =
  | {
      kind: "self-test";
      dialRequest: PhoneDialRequest;
    }
  | {
      kind: "json";
      payload: unknown;
    };

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const phoneDialPayloadSchema = z
  .object({
    destinationNumber: z.string().trim().max(32).optional(),
    callObjective: z.string().trim().min(10).max(1_200),
  })
  .strict();

const NORTH_AMERICAN_E164_PATTERN = /^\+1[2-9]\d{9}$/;
const PREMIUM_AREA_CODES = new Set(["900"]);
const PREMIUM_EXCHANGE_CODES = new Set(["976"]);

export function normalizeNorthAmericanDestination(
  value: string,
): string | null {
  const trimmed = value.trim();

  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) {
    return null;
  }

  const digits = trimmed.replaceAll(/\D/g, "");
  const nationalNumber =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const normalized = `+1${nationalNumber}`;

  if (!NORTH_AMERICAN_E164_PATTERN.test(normalized)) {
    return null;
  }

  return PREMIUM_AREA_CODES.has(nationalNumber.slice(0, 3)) ||
    PREMIUM_EXCHANGE_CODES.has(nationalNumber.slice(3, 6))
    ? null
    : normalized;
}

export function parsePhoneDialRequest(
  payload: unknown,
  verifiedDestinationNumber: string,
): PhoneDialRequest | null {
  const parsed = phoneDialPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return null;
  }

  const verifiedDestination = normalizeNorthAmericanDestination(
    verifiedDestinationNumber,
  );

  if (!verifiedDestination) {
    return null;
  }

  const requestedDestination = parsed.data.destinationNumber?.trim() ?? "";

  if (requestedDestination.length === 0) {
    return {
      destinationNumber: verifiedDestination,
      callObjective: parsed.data.callObjective,
    };
  }

  const destinationNumber =
    normalizeNorthAmericanDestination(requestedDestination);

  return destinationNumber && destinationNumber === verifiedDestination
    ? {
        destinationNumber,
        callObjective: parsed.data.callObjective,
      }
    : null;
}

export async function readPhonePilotStartRequest(
  request: Request,
  credentials: TwilioCredentials,
): Promise<PhonePilotStartRequest | null> {
  const selfTestRequest = (): PhonePilotStartRequest | null => {
    const dialRequest = parsePhoneDialRequest(
      {
        destinationNumber: credentials.verifiedDestinationNumber,
        callObjective:
          "Run a brief conversational self-test as the operator's assistant. Confirm the recipient can hear you, stay polite and brief, and do not make an appointment, purchase, or external commitment.",
      },
      credentials.verifiedDestinationNumber,
    );

    return dialRequest
      ? {
          kind: "self-test",
          dialRequest,
        }
      : null;
  };

  if (request.body === null) {
    return selfTestRequest();
  }

  try {
    const declaredLength = Number(request.headers.get("content-length"));

    if (Number.isFinite(declaredLength) && declaredLength > 4_096) {
      return null;
    }

    const rawBody = await request.text();

    if (rawBody.trim().length === 0) {
      return selfTestRequest();
    }

    if (new TextEncoder().encode(rawBody).byteLength > 4_096) {
      return null;
    }

    return {
      kind: "json",
      payload: JSON.parse(rawBody),
    };
  } catch {
    return null;
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function twilioAuthorization(credentials: TwilioCredentials): string {
  return `Basic ${btoa(
    `${credentials.apiKeySid}:${credentials.apiKeySecret}`,
  )}`;
}

function twilioCallUrl(accountSid: string, callSid?: string): string {
  const callsPath = callSid ? `/Calls/${callSid}.json` : "/Calls.json";

  return `${TWILIO_API_BASE_URL}/Accounts/${accountSid}${callsPath}`;
}

async function parseTwilioCall(response: Response): Promise<TwilioCall> {
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(
      `Twilio call request failed with status ${response.status}.`,
    );
  }

  const parsed = twilioCallSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error("Twilio returned an unexpected call response.");
  }

  return parsed.data;
}

export function buildOpenAISipUri(
  projectId: string,
  _leaseId: string,
  _claimToken: string,
): string {
  const project = encodeURIComponent(projectId);

  // Keep the SIP Request-URI free of custom query headers. OpenAI's Realtime SIP
  // ingress has been failing closed (Twilio child leg `no-answer`) when custom
  // x-* query params are present. Lease binding happens on the signed webhook
  // via the sole active phone safety lease (maxConcurrentCalls = 1).
  return `sip:${project}@sip.api.openai.com;transport=tls`;
}

export function buildPhonePilotTwiml(
  projectId: string,
  leaseId: string,
  claimToken: string,
  maxCallSeconds: number,
): string {
  const sipUri = escapeXml(buildOpenAISipUri(projectId, leaseId, claimToken));

  return [
    "<Response>",
    `<Dial answerOnBridge="false" timeLimit="${maxCallSeconds}" record="do-not-record">`,
    `<Sip>${sipUri}</Sip>`,
    "</Dial>",
    "</Response>",
  ].join("");
}

export async function createTwilioPilotCall(
  credentials: TwilioCredentials,
  destinationNumber: string,
  projectId: string,
  leaseId: string,
  claimToken: string,
  maxCallSeconds: number,
  fetcher: Fetcher = fetch,
): Promise<TwilioCall> {
  const body = new URLSearchParams({
    To: destinationNumber,
    From: credentials.fromNumber,
    TimeLimit: String(maxCallSeconds),
    Twiml: buildPhonePilotTwiml(projectId, leaseId, claimToken, maxCallSeconds),
  });
  const response = await fetcher(twilioCallUrl(credentials.accountSid), {
    method: "POST",
    headers: {
      Authorization: twilioAuthorization(credentials),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  return parseTwilioCall(response);
}

export async function getTwilioPilotCall(
  credentials: TwilioCredentials,
  callSid: string,
  fetcher: Fetcher = fetch,
): Promise<TwilioCall> {
  const response = await fetcher(
    twilioCallUrl(credentials.accountSid, callSid),
    {
      headers: {
        Authorization: twilioAuthorization(credentials),
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  return parseTwilioCall(response);
}

/**
 * Recovers a call whose creation response was lost. Twilio may have placed the
 * call even when the create request timed out, leaving the Worker without a
 * Call SID and therefore without an emergency stop.
 */
export async function findRecoverableTwilioPilotCall(
  credentials: TwilioCredentials,
  destinationNumber: string,
  notBefore: number,
  fetcher: Fetcher = fetch,
): Promise<TwilioCall | null> {
  const url = new URL(twilioCallUrl(credentials.accountSid));

  url.searchParams.set("To", destinationNumber);
  url.searchParams.set("From", credentials.fromNumber);
  url.searchParams.set(
    "StartTime>",
    new Date(notBefore).toISOString().slice(0, 10),
  );

  const response = await fetcher(url, {
    headers: {
      Authorization: twilioAuthorization(credentials),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(
      `Twilio call lookup failed with status ${response.status}.`,
    );
  }

  const parsed = twilioCallListSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error("Twilio returned an unexpected call list response.");
  }

  return (
    parsed.data.calls
      .map((call) => ({
        call,
        createdAt: call.date_created
          ? Date.parse(call.date_created)
          : Number.NaN,
      }))
      .filter(
        (entry) =>
          entry.call.to === destinationNumber &&
          entry.call.from === credentials.fromNumber &&
          Number.isFinite(entry.createdAt) &&
          entry.createdAt >= notBefore,
      )
      .sort((left, right) => right.createdAt - left.createdAt)[0]?.call ?? null
  );
}

export async function stopTwilioPilotCall(
  credentials: TwilioCredentials,
  callSid: string,
  fetcher: Fetcher = fetch,
): Promise<TwilioCall> {
  const response = await fetcher(
    twilioCallUrl(credentials.accountSid, callSid),
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthorization(credentials),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Status: "completed" }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  return parseTwilioCall(response);
}

export function isTerminalTwilioCallStatus(status: string): boolean {
  return ["busy", "canceled", "completed", "failed", "no-answer"].includes(
    status,
  );
}

export type TwilioPilotCallHistoryUpdate = {
  status: string;
  outcome: string;
  endedAt?: number;
  durationSeconds?: number;
  providerCallSid: string;
};

export function buildTwilioPilotCallHistoryUpdate(
  call: TwilioCall,
  providerCallSid: string,
  outcomes: { terminal?: string; nonTerminal?: string } = {},
): TwilioPilotCallHistoryUpdate {
  const terminal = isTerminalTwilioCallStatus(call.status);
  const historyUpdate: TwilioPilotCallHistoryUpdate = {
    status: call.status,
    outcome: terminal
      ? (outcomes.terminal ?? call.status)
      : (outcomes.nonTerminal ?? "in-progress"),
    providerCallSid,
  };

  if (terminal) {
    historyUpdate.endedAt = Date.now();
  }

  if (call.duration) {
    historyUpdate.durationSeconds = Number(call.duration);
  }

  return historyUpdate;
}
