import { describe, expect, it } from "vitest";
import {
  phoneDialDncError,
  resolvePhoneDialDestination,
} from "./phone-destination";

const primary = {
  id: "c-primary",
  displayName: "Primary",
  e164: "+15555550100",
};

describe("phoneDialDncError", () => {
  it("returns PHONE_DNC_BLOCKED when the destination is on the list", () => {
    expect(
      phoneDialDncError("+14805550102", new Set(["+14805550102"])),
    ).toEqual({
      code: "PHONE_DNC_BLOCKED",
      message: "This number is on the assistant do-not-call list.",
    });
  });

  it("returns null when the destination is not on the list", () => {
    expect(phoneDialDncError("+14805550102", new Set())).toBeNull();
  });
});

describe("resolvePhoneDialDestination", () => {
  it("resolves contactId to the contact e164", () => {
    const result = resolvePhoneDialDestination({
      payload: {
        contactId: "c-primary",
        callObjective: "Confirm dinner on Friday night please.",
      },
      contacts: [primary],
      dncE164: new Set(),
      maxContacts: 20,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        destinationNumber: "+15555550100",
        contactId: "c-primary",
        displayName: "Primary",
        saveContact: false,
        callObjective: "Confirm dinner on Friday night please.",
      },
    });
  });

  it("requires attestation for a new destinationNumber", () => {
    const result = resolvePhoneDialDestination({
      payload: {
        destinationNumber: "4805550199",
        callObjective: "Ask if Tuesday still works for the meeting.",
      },
      contacts: [primary],
      dncE164: new Set(),
      maxContacts: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PHONE_ATTESTATION_REQUIRED");
    }
  });

  it("allows attested new numbers and optional saveContact", () => {
    const result = resolvePhoneDialDestination({
      payload: {
        destinationNumber: "(480) 555-0199",
        displayName: "Alex",
        callObjective: "Ask if Tuesday still works for the meeting.",
        ownerAttestation: true,
        saveContact: true,
      },
      contacts: [primary],
      dncE164: new Set(),
      maxContacts: 20,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        destinationNumber: "+14805550199",
        contactId: null,
        displayName: "Alex",
        saveContact: true,
        callObjective: "Ask if Tuesday still works for the meeting.",
      },
    });
  });

  it("blocks DNC destinations", () => {
    const result = resolvePhoneDialDestination({
      payload: {
        contactId: "c-primary",
        callObjective: "Confirm dinner on Friday night please.",
      },
      contacts: [primary],
      dncE164: new Set(["+15555550100"]),
      maxContacts: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PHONE_DNC_BLOCKED");
    }
  });

  it("rejects unknown contactId", () => {
    const result = resolvePhoneDialDestination({
      payload: {
        contactId: "missing",
        callObjective: "Confirm dinner on Friday night please.",
      },
      contacts: [primary],
      dncE164: new Set(),
      maxContacts: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PHONE_CONTACT_NOT_FOUND");
    }
  });

  it("rejects saveContact when at max contacts", () => {
    const contacts = Array.from({ length: 20 }, (_, i) => ({
      id: `c-${i}`,
      displayName: `P${i}`,
      e164: `+1480555${String(1000 + i).padStart(4, "0")}`,
    }));
    const result = resolvePhoneDialDestination({
      payload: {
        destinationNumber: "+16025550100",
        displayName: "New",
        callObjective: "Say hello and ask if now is a good time.",
        ownerAttestation: true,
        saveContact: true,
      },
      contacts,
      dncE164: new Set(),
      maxContacts: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PHONE_CONTACT_LIMIT");
    }
  });
});
