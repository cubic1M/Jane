import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1b: a large county property-tax payment counted as estimated income tax paid
// and silenced the reminder.
const topics = (payee: string) => {
  const d = inputFor("freelancer");
  const account = d.accounts[0]!.id;
  const data = {
    ...d,
    transactions: [
      ...d.transactions.filter((t) => t.pfc !== "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"),
      {
        // Inside the 2026 tax year (from Feb 1) and before the April date: a payment that came after
        // it would be a late one, and one from January is the year before's (sweep 1c).
        date: "2026-03-10",
        amountCents: 50_000_000,
        description: payee,
        pfc: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        accountId: account,
      },
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }).map((s) => s.topic);
};

describe("what counts as estimated tax paid", () => {
  it("does not count a property tax payment", () => {
    expect(topics("COUNTY TAX COLLECTOR")).toContain("estimated_taxes");
  });
  it("still counts a payment to the IRS", () => {
    expect(topics("IRS USATAXPYMT")).not.toContain("estimated_taxes");
  });
});
