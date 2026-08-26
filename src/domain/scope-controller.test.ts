import { describe, expect, it } from "vitest";
import { organizeScope } from "./scope-controller";

describe("scope controller", () => {
  it("captures broad vision while protecting launch scope", () => {
    const scope = organizeScope(
      [
        "Stripe payments",
        "Digital program delivery",
        "Native mobile app",
        "Shot analysis",
        "Facility management",
        "Stripe payments",
      ],
      ["Stripe payments", "Digital program delivery"],
      ["Native mobile app"],
    );

    expect(scope.launch).toEqual([
      "Stripe payments",
      "Digital program delivery",
    ]);
    expect(scope.next).toEqual(["Native mobile app"]);
    expect(scope.future).toEqual(["Shot analysis", "Facility management"]);
  });
});
