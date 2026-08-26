import { z } from "zod";
import { normalizeNorthAmericanDestination } from "./phone-pilot";

export type PhoneContact = {
  id: string;
  displayName: string;
  e164: string;
};

export type PhoneDialResolution = {
  destinationNumber: string;
  contactId: string | null;
  displayName: string;
  saveContact: boolean;
};

export type PhoneDialResolutionError = {
  code:
    | "PHONE_DIAL_REQUEST_INVALID"
    | "PHONE_DNC_BLOCKED"
    | "PHONE_CONTACT_NOT_FOUND"
    | "PHONE_ATTESTATION_REQUIRED"
    | "PHONE_CONTACT_LIMIT";
  message: string;
};

const dialPayloadSchema = z
  .object({
    contactId: z.string().trim().min(1).max(64).optional(),
    destinationNumber: z.string().trim().max(32).optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    callObjective: z.string().trim().min(10).max(1_200),
    ownerAttestation: z.boolean().optional(),
    saveContact: z.boolean().optional(),
  })
  .strict();

export function phoneDialDncError(
  destinationNumber: string,
  dncE164: ReadonlySet<string>,
): PhoneDialResolutionError | null {
  if (!dncE164.has(destinationNumber)) {
    return null;
  }

  return {
    code: "PHONE_DNC_BLOCKED",
    message: "This number is on the assistant do-not-call list.",
  };
}

export function resolvePhoneDialDestination(input: {
  payload: unknown;
  contacts: readonly PhoneContact[];
  dncE164: ReadonlySet<string>;
  maxContacts: number;
}):
  | { ok: true; value: PhoneDialResolution & { callObjective: string } }
  | { ok: false; error: PhoneDialResolutionError } {
  const parsed = dialPayloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "PHONE_DIAL_REQUEST_INVALID",
        message:
          "Provide a call objective of at least 10 characters and either a contactId or a destination number.",
      },
    };
  }

  const data = parsed.data;
  const hasContact = Boolean(data.contactId);
  const hasNumber = Boolean(data.destinationNumber?.trim());

  if (hasContact === hasNumber) {
    return {
      ok: false,
      error: {
        code: "PHONE_DIAL_REQUEST_INVALID",
        message: "Provide exactly one of contactId or destinationNumber.",
      },
    };
  }

  let destinationNumber: string;
  let contactId: string | null = null;
  let displayName: string;
  let saveContact = false;

  if (data.contactId) {
    const contact = input.contacts.find((item) => item.id === data.contactId);
    if (!contact) {
      return {
        ok: false,
        error: {
          code: "PHONE_CONTACT_NOT_FOUND",
          message: "That person is not in your saved contacts.",
        },
      };
    }
    destinationNumber = contact.e164;
    contactId = contact.id;
    displayName = contact.displayName;
  } else {
    if (data.ownerAttestation !== true) {
      return {
        ok: false,
        error: {
          code: "PHONE_ATTESTATION_REQUIRED",
          message:
            "Confirm you have permission or a personal relationship before calling a new number.",
        },
      };
    }
    const normalized = normalizeNorthAmericanDestination(
      data.destinationNumber ?? "",
    );
    if (!normalized) {
      return {
        ok: false,
        error: {
          code: "PHONE_DIAL_REQUEST_INVALID",
          message: "Enter a valid US or Canada phone number.",
        },
      };
    }
    const existing = input.contacts.find((item) => item.e164 === normalized);
    if (existing) {
      destinationNumber = existing.e164;
      contactId = existing.id;
      displayName = existing.displayName;
      saveContact = false;
    } else {
      destinationNumber = normalized;
      displayName = data.displayName?.trim() || normalized;
      saveContact = data.saveContact === true;
      if (saveContact && input.contacts.length >= input.maxContacts) {
        return {
          ok: false,
          error: {
            code: "PHONE_CONTACT_LIMIT",
            message: `You can save at most ${input.maxContacts} people.`,
          },
        };
      }
    }
  }

  const dncError = phoneDialDncError(destinationNumber, input.dncE164);
  if (dncError) {
    return { ok: false, error: dncError };
  }

  return {
    ok: true,
    value: {
      destinationNumber,
      contactId,
      displayName,
      saveContact,
      callObjective: data.callObjective,
    },
  };
}
