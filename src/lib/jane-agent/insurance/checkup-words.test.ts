import { describe, expect, it } from "vitest";
import type { Checkup } from "@/lib/insurance/checkups";
import { CHECKUP_MAX_CHARS, checkupBody } from "./checkup-words";

// The checkup in the chat says up to three changes, as many as fit, and points to the page for
// the rest (spec steps 106 and 201: a business's long liability line made the answer too long).

const rec = (title: string, risk: string) => ({
  key: "liability_up",
  policyId: null,
  kind: "auto",
  title,
  costCents: 25_560,
  cost: "About $255.60 more a year",
  risk,
  cents: [25_560],
});
const checkup = (recommendations: ReturnType<typeof rec>[]) =>
  ({
    id: "c1",
    reason: "asked",
    recommendations,
    createdAt: new Date(),
    seenAt: null,
  }) as unknown as Checkup;

describe("checkupBody", () => {
  it("lists what fits and sends the rest to the page", () => {
    const long = "x".repeat(200);
    const body = checkupBody(checkup([rec("One.", long), rec("Two.", long), rec("Three.", long)]));
    expect(body.length).toBeLessThanOrEqual(CHECKUP_MAX_CHARS + 120);
    expect(body).toContain("- One.");
    expect(body).toContain("- Two.");
    expect(body).not.toContain("- Three.");
    expect(body).toContain("And 1 more on the checkup page.");
  });

  it("lists up to three short ones", () => {
    const body = checkupBody(
      checkup([rec("One.", "a"), rec("Two.", "b"), rec("Three.", "c"), rec("Four.", "d")]),
    );
    expect(body).toContain("- Three.");
    expect(body).toContain("And 1 more on the checkup page.");
  });
});
