import { describe, expect, it, vi } from "vitest";
import {
  buildPhoneSessionConfig,
  extractSipHeader,
  PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS,
  resolveCalendarToolingForAccept,
} from "./openai-sip";

describe("OpenAI Realtime SIP configuration", () => {
  it("extracts the safety lease header without case sensitivity", () => {
    expect(
      extractSipHeader(
        [{ name: "X-Slim-Lease-Id", value: "lease-test" }],
        "x-slim-lease-id",
      ),
    ).toBe("lease-test");
    expect(
      extractSipHeader(
        [{ name: "X-Slim-Claim-Token", value: "claim-test" }],
        "x-slim-claim-token",
      ),
    ).toBe("claim-test");
  });

  it("uses interruption-aware low-latency audio without extra transcription", () => {
    const config = buildPhoneSessionConfig(
      "Ask whether Tuesday morning appointments are available.",
    );

    expect(config.type).toBe("realtime");
    expect(config.output_modalities).toEqual(["audio"]);
    expect(config.audio?.input?.transcription).toBeUndefined();
    expect(config.audio?.input?.turn_detection).toMatchObject({
      type: "server_vad",
      create_response: true,
      interrupt_response: true,
      silence_duration_ms: 350,
    });
    expect(config.audio?.output?.voice).toBe("marin");
    expect(config.max_output_tokens).toBe(512);
    expect(config.instructions).toContain(
      "Tuesday morning appointments are available",
    );
    expect(config.instructions).toContain("Never make an emergency call");
  });

  it("truthfully discloses AI use without claiming the call is recorded", () => {
    expect(PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS).toContain(
      "the operator's assistant",
    );
    expect(PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS).toContain(
      "you're their secretary right now",
    );
    expect(PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS).toContain(
      "you are an AI assistant",
    );
    expect(PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS).toContain(
      "the call is not recorded",
    );
    expect(PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS).not.toContain(
      "being recorded",
    );
    expect(PHONE_PILOT_INITIAL_GREETING_INSTRUCTIONS).not.toContain(
      "Slim Sales Agent",
    );
  });

  it("frames the ongoing phone persona as the operator's assistant", () => {
    const config = buildPhoneSessionConfig(
      "Ask whether Tuesday morning appointments are available.",
    );

    expect(config.instructions).toContain("You are the operator's assistant");
    expect(config.instructions).toContain(
      "never imply that the operator is speaking",
    );
    expect(config.instructions).toContain("Calendar access is not connected");
    expect(config.instructions).not.toContain(
      "Slim's openly disclosed AI phone assistant",
    );
  });

  it("attaches Google Calendar tools when tooling is available", () => {
    const config = buildPhoneSessionConfig(
      "Check calendar availability and book a Tuesday appointment if free.",
      {
        accessToken: "ya29.test-token",
        allowWrites: true,
      },
    );

    expect(config.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mcp",
          connector_id: "connector_googlecalendar",
        }),
        expect.objectContaining({
          type: "function",
          name: "create_calendar_event",
        }),
      ]),
    );
    expect(config.instructions).toContain(
      "read the operator's Google Calendar",
    );
    expect(config.instructions).toContain(
      "create or update events only when the owner-supplied objective asks",
    );
  });

  it("fails open to null when calendar tooling throws before SIP accept", async () => {
    const tooling = await resolveCalendarToolingForAccept(async () => {
      throw new Error("Google token refresh failed");
    }, "Book Tuesday if free.");

    expect(tooling).toBeNull();
  });

  it("fails open to null when calendar tooling exceeds the accept timeout", async () => {
    const tooling = await resolveCalendarToolingForAccept(
      async () =>
        await new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                accessToken: "ya29.too-late",
                allowWrites: true,
              }),
            50,
          );
        }),
      "Book Tuesday if free.",
      10,
    );

    expect(tooling).toBeNull();
  });

  it("returns calendar tooling when it resolves before the accept timeout", async () => {
    const resolve = vi.fn(async () => ({
      accessToken: "ya29.ready",
      allowWrites: false,
    }));

    const tooling = await resolveCalendarToolingForAccept(
      resolve,
      "Check the calendar.",
      100,
    );

    expect(tooling).toEqual({
      accessToken: "ya29.ready",
      allowWrites: false,
    });
    expect(resolve).toHaveBeenCalledOnce();
  });
});
