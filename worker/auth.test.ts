import { describe, expect, it } from "vitest";
import {
  isPreviewAuthorized,
  isPreviewRequestIntentValid,
  requestIntentRejectedResponse,
  unauthorizedResponse,
} from "./auth";

function authorizedRequest(username: string, password: string): Request {
  return new Request("https://preview.example.test", {
    headers: {
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
    },
  });
}

describe("preview authentication", () => {
  it("accepts the configured user and password", async () => {
    await expect(
      isPreviewAuthorized(authorizedRequest("operator", "correct"), "correct"),
    ).resolves.toBe(true);
  });

  it("rejects a wrong password, wrong user, and missing credentials", async () => {
    await expect(
      isPreviewAuthorized(authorizedRequest("operator", "wrong"), "correct"),
    ).resolves.toBe(false);
    await expect(
      isPreviewAuthorized(authorizedRequest("someone", "correct"), "correct"),
    ).resolves.toBe(false);
    await expect(
      isPreviewAuthorized(
        new Request("https://preview.example.test"),
        "correct",
      ),
    ).resolves.toBe(false);
  });

  it("returns a private Basic authentication challenge", () => {
    const response = unauthorizedResponse();

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("preview request intent", () => {
  it("accepts safe reads without an intent header", () => {
    expect(
      isPreviewRequestIntentValid(
        new Request("https://preview.example.test/api/runtime-safety"),
      ),
    ).toBe(true);
  });

  it("accepts an owner UI POST from the same origin", () => {
    expect(
      isPreviewRequestIntentValid(
        new Request("https://preview.example.test/api/realtime/client-secret", {
          method: "POST",
          headers: {
            Origin: "https://preview.example.test",
            "Sec-Fetch-Site": "same-origin",
            "X-Slim-Request-Intent": "owner-ui-v1",
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects a POST without the owner UI intent header", () => {
    expect(
      isPreviewRequestIntentValid(
        new Request("https://preview.example.test/api/realtime/client-secret", {
          method: "POST",
          headers: { Origin: "https://preview.example.test" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects cross-site and foreign-origin POST requests", () => {
    expect(
      isPreviewRequestIntentValid(
        new Request("https://preview.example.test/api/realtime/client-secret", {
          method: "POST",
          headers: {
            Origin: "https://attacker.example",
            "Sec-Fetch-Site": "cross-site",
            "X-Slim-Request-Intent": "owner-ui-v1",
          },
        }),
      ),
    ).toBe(false);
  });

  it("returns a private forbidden response", () => {
    const response = requestIntentRejectedResponse();

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
