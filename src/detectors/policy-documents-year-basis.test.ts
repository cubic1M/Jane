import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { INSURANCE_DETECTORS } from "./insurance";

// CodeRabbit sweep 1c (#2270): "a tenth of that" read against the months seen ($300), while the
// saving is figured on the year ($1,200): the card names both figures.
describe("policy documents card", () => {
  it("compares the tenth to the year it figured it on, not the months seen", () => {
    const data = inputFor("family");
    data.unreadPolicyDocuments = 1;
    data.transactions = data.transactions.filter(
      (t) => t.pfc !== "GENERAL_SERVICES_INSURANCE" && t.date >= "2026-08-01",
    );
    data.transactions = [
      ...data.transactions,
      ...["08", "09", "10"].map(
        (m) =>
          ({
            date: `2026-${m}-10`,
            amountCents: 10_000,
            description: "STATE FARM AUTO",
            pfc: "GENERAL_SERVICES_INSURANCE",
          }) as never,
      ),
    ];
    const profile = buildProfile(data);
    const d = INSURANCE_DETECTORS.find((x) => x.topic === "policy_documents")!;
    const s = d.detect({ profile, data })!;
    expect(s.why).toContain("$300.00");
    expect(s.why).toContain("$1,200.00");
    expect(s.why).toContain("$120.00");
    expect(s.why).not.toContain("a tenth of that");
  });
});
