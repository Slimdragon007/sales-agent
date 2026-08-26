import { describe, expect, it } from "vitest";
import { isConfiguredSecret } from "./secrets";

describe("isConfiguredSecret", () => {
  it("accepts a non-empty real value", () => {
    expect(isConfiguredSecret("sk-live-example")).toBe(true);
    expect(isConfiguredSecret(" +15551234567 ")).toBe(true);
  });

  it("rejects missing, empty, and whitespace-only values", () => {
    expect(isConfiguredSecret(undefined)).toBe(false);
    expect(isConfiguredSecret(null)).toBe(false);
    expect(isConfiguredSecret("")).toBe(false);
    expect(isConfiguredSecret("   ")).toBe(false);
  });

  it("rejects the 1Password FILL_ME placeholder", () => {
    expect(isConfiguredSecret("FILL_ME")).toBe(false);
    expect(isConfiguredSecret(" FILL_ME ")).toBe(false);
  });
});
