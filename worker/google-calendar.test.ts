import { describe, expect, it } from "vitest";
import {
  buildGoogleCalendarAuthorizeUrl,
  buildGoogleCalendarReadTool,
  objectiveAllowsCalendarWrites,
  parseCreateCalendarEventArgs,
  parseUpdateCalendarEventArgs,
} from "./google-calendar";

describe("google calendar tooling policy", () => {
  it("builds a consent URL with offline calendar scopes", () => {
    const url = buildGoogleCalendarAuthorizeUrl(
      {
        clientId: "client.apps.googleusercontent.com",
        clientSecret: "secret",
        redirectUri:
          "https://sales-agent.example.workers.dev/api/google/oauth/callback",
      },
      "state-token",
    );

    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain(encodeURIComponent("calendar.events"));
    expect(url).toContain("state=state-token");
    expect(url).not.toContain("login_hint=");

    const hinted = buildGoogleCalendarAuthorizeUrl(
      {
        clientId: "client.apps.googleusercontent.com",
        clientSecret: "secret",
        redirectUri:
          "https://sales-agent.example.workers.dev/api/google/oauth/callback",
      },
      "state-token",
      "operator@example.com",
    );
    expect(hinted).toContain(
      `login_hint=${encodeURIComponent("operator@example.com")}`,
    );
  });

  it("configures the Realtime Google Calendar connector as read-only", () => {
    expect(buildGoogleCalendarReadTool("ya29.access")).toMatchObject({
      type: "mcp",
      connector_id: "connector_googlecalendar",
      authorization: "ya29.access",
      require_approval: "never",
      allowed_tools: { read_only: true },
    });
  });

  it("only allows writes when the call objective asks for scheduling", () => {
    expect(
      objectiveAllowsCalendarWrites(
        "Check the operator's Tuesday afternoon availability and propose two times.",
      ),
    ).toBe(true);
    expect(
      objectiveAllowsCalendarWrites(
        "Ask whether the package arrived and take a message.",
      ),
    ).toBe(false);
  });

  it("requires caller confirmation before creating or updating events", () => {
    expect(
      parseCreateCalendarEventArgs(
        JSON.stringify({
          summary: "Dentist",
          startDateTime: "2026-08-01T15:00:00",
          endDateTime: "2026-08-01T16:00:00",
          callerConfirmed: true,
        }),
      ),
    ).toMatchObject({
      summary: "Dentist",
      timeZone: "America/Phoenix",
    });
    expect(
      parseCreateCalendarEventArgs(
        JSON.stringify({
          summary: "Dentist",
          startDateTime: "2026-08-01T15:00:00",
          endDateTime: "2026-08-01T16:00:00",
          callerConfirmed: false,
        }),
      ),
    ).toBeNull();
    expect(
      parseUpdateCalendarEventArgs(
        JSON.stringify({
          eventId: "abc123",
          summary: "Moved dentist",
          callerConfirmed: true,
        }),
      ),
    ).toMatchObject({
      eventId: "abc123",
      mutation: { summary: "Moved dentist" },
    });
  });
});
