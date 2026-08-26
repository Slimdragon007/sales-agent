import type { PhoneContact } from "./phone-destination";

export function contactsAfterSeed(
  existing: PhoneContact[],
  seed: PhoneContact,
): PhoneContact[] {
  return existing.length === 0 ? [seed] : existing;
}
