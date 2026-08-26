import { describe, expect, it } from "vitest";
import { contactsAfterSeed } from "./phone-contacts-seed";

describe("contactsAfterSeed", () => {
  it("seeds only when empty", () => {
    expect(
      contactsAfterSeed([], {
        id: "seed-primary",
        displayName: "Primary",
        e164: "+15555550100",
      }),
    ).toHaveLength(1);

    expect(
      contactsAfterSeed([{ id: "x", displayName: "A", e164: "+14805550101" }], {
        id: "seed-primary",
        displayName: "Primary",
        e164: "+15555550100",
      }),
    ).toHaveLength(1);
  });
});
