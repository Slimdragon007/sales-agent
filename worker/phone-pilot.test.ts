import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTwilioPilotCallHistoryUpdate,
  buildPhonePilotTwiml,
  createTwilioPilotCall,
  findRecoverableTwilioPilotCall,
  isTerminalTwilioCallStatus,
  normalizeNorthAmericanDestination,
  parsePhoneDialRequest,
  readPhonePilotStartRequest,
  stopTwilioPilotCall,
  type TwilioCredentials,
} from "./phone-pilot";

const credentials: TwilioCredentials = {
  accountSid: `AC${"1".repeat(32)}`,
  apiKeySid: `SK${"2".repeat(32)}`,
  apiKeySecret: "test-secret",
  fromNumber: "+14805550101",
  verifiedDestinationNumber: "+14805550102",
};

const callPayload = {
  sid: `CA${"3".repeat(32)}`,
  status: "queued",
  duration: null,
  price: null,
  price_unit: "USD",
};

describe("phone pilot connector", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds non-recording SIP TwiML with a hard carrier time limit", () => {
    const twiml = buildPhonePilotTwiml(
      "proj_test",
      "lease&test",
      "claim&test",
      300,
    );

    expect(twiml).toContain('timeLimit="300"');
    expect(twiml).toContain('record="do-not-record"');
    expect(twiml).toContain("sip:proj_test@sip.api.openai.com;transport=tls");
    expect(twiml).not.toContain("x-slim-lease-id");
    expect(twiml).not.toContain("x-slim-claim-token");
  });

  it("normalizes North American numbers without accepting international calls", () => {
    expect(normalizeNorthAmericanDestination("(480) 555-0102")).toBe(
      "+14805550102",
    );
    expect(normalizeNorthAmericanDestination("+1 480 555 0102")).toBe(
      "+14805550102",
    );
    expect(normalizeNorthAmericanDestination("+44 20 7946 0958")).toBeNull();
    expect(normalizeNorthAmericanDestination("123")).toBeNull();
  });

  it("recovers the newest requested-recipient call created at or after the lease", async () => {
    const leaseStartedAt = Date.parse("2026-07-31T06:00:00Z");
    const destinationNumber = "+14805550103";
    const listed = {
      calls: [
        {
          sid: `CA${"a".repeat(32)}`,
          status: "in-progress",
          to: destinationNumber,
          from: credentials.fromNumber,
          date_created: "Fri, 31 Jul 2026 06:00:30 +0000",
        },
        {
          sid: `CA${"f".repeat(32)}`,
          status: "in-progress",
          to: credentials.verifiedDestinationNumber,
          from: credentials.fromNumber,
          date_created: "Fri, 31 Jul 2026 06:01:00 +0000",
        },
        {
          sid: `CA${"b".repeat(32)}`,
          status: "completed",
          to: destinationNumber,
          from: credentials.fromNumber,
          date_created: "Fri, 31 Jul 2026 06:00:10 +0000",
        },
      ],
    };
    let requestedUrl = "";
    const recovered = await findRecoverableTwilioPilotCall(
      credentials,
      destinationNumber,
      leaseStartedAt,
      (input) => {
        requestedUrl =
          input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : input;

        return Promise.resolve(new Response(JSON.stringify(listed)));
      },
    );

    expect(recovered?.sid).toBe(`CA${"a".repeat(32)}`);
    expect(requestedUrl).toContain(
      `To=${encodeURIComponent(destinationNumber)}`,
    );
    expect(requestedUrl).toContain(
      `From=${encodeURIComponent(credentials.fromNumber)}`,
    );
  });

  it("keeps recovering verified-recipient calls for the seed path", async () => {
    const leaseStartedAt = Date.parse("2026-07-31T06:00:00Z");
    const listed = {
      calls: [
        {
          sid: `CA${"e".repeat(32)}`,
          status: "in-progress",
          to: credentials.verifiedDestinationNumber,
          from: credentials.fromNumber,
          date_created: "Fri, 31 Jul 2026 06:00:30 +0000",
        },
      ],
    };

    await expect(
      findRecoverableTwilioPilotCall(
        credentials,
        credentials.verifiedDestinationNumber,
        leaseStartedAt,
        () => Promise.resolve(new Response(JSON.stringify(listed))),
      ),
    ).resolves.toMatchObject({ sid: `CA${"e".repeat(32)}` });
  });

  it("ignores calls that predate the lease or target another number", async () => {
    const leaseStartedAt = Date.parse("2026-07-31T06:00:00Z");
    const destinationNumber = "+14805550103";
    const listed = {
      calls: [
        {
          sid: `CA${"c".repeat(32)}`,
          status: "in-progress",
          to: destinationNumber,
          from: credentials.fromNumber,
          date_created: "Fri, 31 Jul 2026 05:59:59 +0000",
        },
        {
          sid: `CA${"d".repeat(32)}`,
          status: "in-progress",
          to: "+14805559999",
          from: credentials.fromNumber,
          date_created: "Fri, 31 Jul 2026 06:05:00 +0000",
        },
      ],
    };

    await expect(
      findRecoverableTwilioPilotCall(
        credentials,
        destinationNumber,
        leaseStartedAt,
        () => Promise.resolve(new Response(JSON.stringify(listed))),
      ),
    ).resolves.toBeNull();
  });

  it("returns null when the account reports no calls", async () => {
    await expect(
      findRecoverableTwilioPilotCall(
        credentials,
        credentials.verifiedDestinationNumber,
        Date.now(),
        () => Promise.resolve(new Response(JSON.stringify({ calls: [] }))),
      ),
    ).resolves.toBeNull();
  });

  it("rejects premium-rate numbers during normalization, not only by comparison", () => {
    expect(normalizeNorthAmericanDestination("+1 900 555 1234")).toBeNull();
    expect(normalizeNorthAmericanDestination("+1 480 976 1234")).toBeNull();
    expect(normalizeNorthAmericanDestination("+1 800 555 0102")).toBe(
      "+18005550102",
    );
  });

  it("requires a bounded destination and call objective", () => {
    expect(
      parsePhoneDialRequest(
        {
          destinationNumber: "480-555-0102",
          callObjective:
            "Ask whether Tuesday morning appointments are available.",
        },
        credentials.verifiedDestinationNumber,
      ),
    ).toEqual({
      destinationNumber: "+14805550102",
      callObjective: "Ask whether Tuesday morning appointments are available.",
    });
    expect(
      parsePhoneDialRequest(
        {
          destinationNumber: "480-555-0102",
          callObjective: "Too short",
        },
        credentials.verifiedDestinationNumber,
      ),
    ).toBeNull();
  });

  it("dials the verified recipient when destination is omitted", () => {
    expect(
      parsePhoneDialRequest(
        {
          callObjective:
            "Introduce yourself as the operator's assistant and take a message.",
        },
        credentials.verifiedDestinationNumber,
      ),
    ).toEqual({
      destinationNumber: "+14805550102",
      callObjective:
        "Introduce yourself as the operator's assistant and take a message.",
    });
  });

  it("preserves JSON start payloads for contact and attestation resolution", async () => {
    const payload = {
      contactId: "c-primary",
      callObjective: "Confirm dinner on Friday night please.",
    };

    await expect(
      readPhonePilotStartRequest(
        new Request("https://preview.test/api/phone-pilot/start", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
        credentials,
      ),
    ).resolves.toEqual({
      kind: "json",
      payload,
    });
  });

  it("fails closed for premium, unsupported, and unverified destinations", () => {
    const objective = "Ask whether Tuesday morning appointments are available.";

    expect(
      parsePhoneDialRequest(
        {
          destinationNumber: "+1 900 555 0102",
          callObjective: objective,
        },
        credentials.verifiedDestinationNumber,
      ),
    ).toBeNull();
    expect(
      parsePhoneDialRequest(
        {
          destinationNumber: "+1 242 555 0102",
          callObjective: objective,
        },
        credentials.verifiedDestinationNumber,
      ),
    ).toBeNull();
    expect(
      parsePhoneDialRequest(
        {
          destinationNumber: "+1 480 555 0103",
          callObjective: objective,
        },
        credentials.verifiedDestinationNumber,
      ),
    ).toBeNull();
  });

  it("fails closed when the configured verified destination is missing or malformed", () => {
    const payload = {
      destinationNumber: "+14805550102",
      callObjective: "Ask whether Tuesday morning appointments are available.",
    };

    expect(parsePhoneDialRequest(payload, "")).toBeNull();
    expect(parsePhoneDialRequest(payload, "not-a-phone")).toBeNull();
    expect(parsePhoneDialRequest(payload, "+44 20 7946 0958")).toBeNull();
  });

  it("creates an owner-selected call with inline SIP TwiML", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher = (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;

      return Promise.resolve(Response.json(callPayload, { status: 201 }));
    };

    await expect(
      createTwilioPilotCall(
        credentials,
        "+14805550103",
        "proj_test",
        "lease-test",
        "claim-test",
        300,
        fetcher,
      ),
    ).resolves.toEqual(callPayload);

    const body = capturedInit?.body;

    expect(capturedInit?.method).toBe("POST");
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body instanceof URLSearchParams ? body.get("To") : null).toBe(
      "+14805550103",
    );
    expect(body instanceof URLSearchParams ? body.get("From") : null).toBe(
      credentials.fromNumber,
    );
    expect(body instanceof URLSearchParams ? body.get("TimeLimit") : null).toBe(
      "300",
    );
  });

  it("ends the carrier call by updating its status to completed", async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher = (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;

      return Promise.resolve(
        Response.json(
          {
            ...callPayload,
            status: "completed",
          },
          { status: 200 },
        ),
      );
    };

    await stopTwilioPilotCall(credentials, callPayload.sid, fetcher);

    const body = capturedInit?.body;

    expect(body instanceof URLSearchParams ? body.get("Status") : null).toBe(
      "completed",
    );
  });

  it("recognizes terminal carrier states", () => {
    expect(isTerminalTwilioCallStatus("completed")).toBe(true);
    expect(isTerminalTwilioCallStatus("failed")).toBe(true);
    expect(isTerminalTwilioCallStatus("in-progress")).toBe(false);
  });

  it("maps terminal carrier calls to Recents history updates", () => {
    const endedAt = Date.parse("2026-08-01T20:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(endedAt);

    expect(
      buildTwilioPilotCallHistoryUpdate(
        {
          ...callPayload,
          status: "completed",
          duration: "42",
        },
        callPayload.sid,
      ),
    ).toEqual({
      status: "completed",
      outcome: "completed",
      endedAt,
      durationSeconds: 42,
      providerCallSid: callPayload.sid,
    });
  });
});
