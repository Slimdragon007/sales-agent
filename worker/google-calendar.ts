import { z } from "zod";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export type GoogleCalendarOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleCalendarTokenSet = {
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: number | null;
  scope: string | null;
};

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const calendarEventSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  start: z
    .object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .optional(),
  end: z
    .object({
      dateTime: z.string().optional(),
      date: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .optional(),
});

export type CalendarEventMutation = {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone?: string;
  attendees?: string[];
};

/** Optional `loginHint` is omitted from the URL when empty. */
export function buildGoogleCalendarAuthorizeUrl(
  config: GoogleCalendarOAuthConfig,
  state: string,
  loginHint?: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state,
  });

  const trimmedHint = loginHint?.trim() ?? "";
  if (trimmedHint) {
    params.set("login_hint", trimmedHint);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCalendarAuthorizationCode(
  config: GoogleCalendarOAuthConfig,
  code: string,
): Promise<GoogleCalendarTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error("Google authorization code exchange failed.");
  }

  const parsed = tokenResponseSchema.safeParse(await response.json());

  if (!parsed.success || !parsed.data.refresh_token) {
    throw new Error("Google did not return a refresh token.");
  }

  return {
    refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token,
    accessExpiresAt: Date.now() + parsed.data.expires_in * 1_000,
    scope: parsed.data.scope ?? null,
  };
}

export async function refreshGoogleCalendarAccessToken(
  config: Pick<GoogleCalendarOAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
): Promise<GoogleCalendarTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error("Google access token refresh failed.");
  }

  const parsed = tokenResponseSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error("Google returned an invalid access token payload.");
  }

  return {
    refreshToken,
    accessToken: parsed.data.access_token,
    accessExpiresAt: Date.now() + parsed.data.expires_in * 1_000,
    scope: parsed.data.scope ?? null,
  };
}

export function buildGoogleCalendarReadTool(accessToken: string) {
  return {
    type: "mcp" as const,
    server_label: "google_calendar",
    connector_id: "connector_googlecalendar" as const,
    authorization: accessToken,
    require_approval: "never" as const,
    allowed_tools: {
      read_only: true,
    },
    server_description:
      "The operator's Google Calendar. Use only to check availability and existing events.",
  };
}

export function buildGoogleCalendarWriteTools() {
  return [
    {
      type: "function" as const,
      name: "create_calendar_event",
      description:
        "Create a calendar event for the operator only after the caller verbally confirms the exact summary, start, and end. Use America/Phoenix unless another timezone is explicit.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          startDateTime: {
            type: "string",
            description: "ISO-8601 local or offset datetime for the start.",
          },
          endDateTime: {
            type: "string",
            description: "ISO-8601 local or offset datetime for the end.",
          },
          timeZone: { type: "string" },
          attendees: {
            type: "array",
            items: { type: "string" },
          },
          callerConfirmed: {
            type: "boolean",
            description:
              "Must be true only after the caller confirmed the exact event details on the call.",
          },
        },
        required: [
          "summary",
          "startDateTime",
          "endDateTime",
          "callerConfirmed",
        ],
      },
    },
    {
      type: "function" as const,
      name: "update_calendar_event",
      description:
        "Update an existing calendar event for the operator only after the caller verbally confirms the change.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          eventId: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          startDateTime: { type: "string" },
          endDateTime: { type: "string" },
          timeZone: { type: "string" },
          callerConfirmed: {
            type: "boolean",
            description:
              "Must be true only after the caller confirmed the exact update on the call.",
          },
        },
        required: ["eventId", "callerConfirmed"],
      },
    },
  ];
}

export function objectiveAllowsCalendarWrites(callObjective: string): boolean {
  return /\b(calendar|schedule|reschedule|appointment|meeting|book|availability)\b/i.test(
    callObjective,
  );
}

const createEventArgsSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  location: z.string().trim().max(300).optional(),
  startDateTime: z.string().trim().min(1).max(64),
  endDateTime: z.string().trim().min(1).max(64),
  timeZone: z.string().trim().min(1).max(64).optional(),
  attendees: z.array(z.string().email().max(254)).max(10).optional(),
  callerConfirmed: z.literal(true),
});

const updateEventArgsSchema = z.object({
  eventId: z.string().trim().min(1).max(256),
  summary: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).optional(),
  location: z.string().trim().max(300).optional(),
  startDateTime: z.string().trim().min(1).max(64).optional(),
  endDateTime: z.string().trim().min(1).max(64).optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
  callerConfirmed: z.literal(true),
});

export function parseCreateCalendarEventArgs(
  rawArguments: string,
): CalendarEventMutation | null {
  try {
    const parsed = createEventArgsSchema.safeParse(JSON.parse(rawArguments));

    return parsed.success
      ? {
          summary: parsed.data.summary,
          ...(parsed.data.description
            ? { description: parsed.data.description }
            : {}),
          ...(parsed.data.location ? { location: parsed.data.location } : {}),
          startDateTime: parsed.data.startDateTime,
          endDateTime: parsed.data.endDateTime,
          timeZone: parsed.data.timeZone ?? "America/Phoenix",
          ...(parsed.data.attendees
            ? { attendees: parsed.data.attendees }
            : {}),
        }
      : null;
  } catch {
    return null;
  }
}

export function parseUpdateCalendarEventArgs(rawArguments: string): {
  eventId: string;
  mutation: Partial<CalendarEventMutation>;
} | null {
  try {
    const parsed = updateEventArgsSchema.safeParse(JSON.parse(rawArguments));

    if (!parsed.success) {
      return null;
    }

    return {
      eventId: parsed.data.eventId,
      mutation: {
        ...(parsed.data.summary ? { summary: parsed.data.summary } : {}),
        ...(parsed.data.description
          ? { description: parsed.data.description }
          : {}),
        ...(parsed.data.location ? { location: parsed.data.location } : {}),
        ...(parsed.data.startDateTime
          ? { startDateTime: parsed.data.startDateTime }
          : {}),
        ...(parsed.data.endDateTime
          ? { endDateTime: parsed.data.endDateTime }
          : {}),
        ...(parsed.data.timeZone ? { timeZone: parsed.data.timeZone } : {}),
      },
    };
  } catch {
    return null;
  }
}

function eventBodyFromMutation(mutation: Partial<CalendarEventMutation>) {
  const body: Record<string, unknown> = {};

  if (mutation.summary) {
    body.summary = mutation.summary;
  }

  if (mutation.description) {
    body.description = mutation.description;
  }

  if (mutation.location) {
    body.location = mutation.location;
  }

  if (mutation.startDateTime && mutation.endDateTime) {
    const timeZone = mutation.timeZone ?? "America/Phoenix";
    body.start = { dateTime: mutation.startDateTime, timeZone };
    body.end = { dateTime: mutation.endDateTime, timeZone };
  }

  if (mutation.attendees?.length) {
    body.attendees = mutation.attendees.map((email) => ({ email }));
  }

  return body;
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  mutation: CalendarEventMutation,
): Promise<{ id: string; summary?: string; htmlLink?: string }> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBodyFromMutation(mutation)),
    },
  );

  if (!response.ok) {
    throw new Error("Google Calendar create failed.");
  }

  const parsed = calendarEventSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error("Google Calendar create returned an invalid event.");
  }

  return {
    id: parsed.data.id,
    ...(parsed.data.summary ? { summary: parsed.data.summary } : {}),
    ...(parsed.data.htmlLink ? { htmlLink: parsed.data.htmlLink } : {}),
  };
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  eventId: string,
  mutation: Partial<CalendarEventMutation>,
): Promise<{ id: string; summary?: string; htmlLink?: string }> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBodyFromMutation(mutation)),
    },
  );

  if (!response.ok) {
    throw new Error("Google Calendar update failed.");
  }

  const parsed = calendarEventSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error("Google Calendar update returned an invalid event.");
  }

  return {
    id: parsed.data.id,
    ...(parsed.data.summary ? { summary: parsed.data.summary } : {}),
    ...(parsed.data.htmlLink ? { htmlLink: parsed.data.htmlLink } : {}),
  };
}
