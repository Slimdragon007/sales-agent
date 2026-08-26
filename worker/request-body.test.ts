import { describe, expect, it } from "vitest";
import { readLeaseIdFromRequest } from "./request-body";

function leaseRequest(body: BodyInit | null): Request {
  return new Request("https://example.test/api/realtime/release", {
    method: "POST",
    body,
  });
}

describe("lease request body", () => {
  it("reads a well-formed lease identifier", async () => {
    const request = leaseRequest(JSON.stringify({ leaseId: "lease-1" }));

    await expect(readLeaseIdFromRequest(request)).resolves.toBe("lease-1");
  });

  it("returns null instead of throwing for an absent body", async () => {
    await expect(
      readLeaseIdFromRequest(leaseRequest(null)),
    ).resolves.toBeNull();
  });

  it("returns null instead of throwing for an empty body", async () => {
    await expect(readLeaseIdFromRequest(leaseRequest(""))).resolves.toBeNull();
  });

  it("returns null instead of throwing for malformed JSON", async () => {
    await expect(
      readLeaseIdFromRequest(leaseRequest("{ not json")),
    ).resolves.toBeNull();
  });

  it("rejects a lease identifier that is missing, mistyped, or oversized", async () => {
    await expect(
      readLeaseIdFromRequest(leaseRequest(JSON.stringify({}))),
    ).resolves.toBeNull();
    await expect(
      readLeaseIdFromRequest(leaseRequest(JSON.stringify({ leaseId: 7 }))),
    ).resolves.toBeNull();
    await expect(
      readLeaseIdFromRequest(leaseRequest(JSON.stringify({ leaseId: "" }))),
    ).resolves.toBeNull();
    await expect(
      readLeaseIdFromRequest(
        leaseRequest(JSON.stringify({ leaseId: "x".repeat(129) })),
      ),
    ).resolves.toBeNull();
  });
});
