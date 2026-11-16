import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { findTaxFacts, taxProfileView, type StoredTaxProfile } from "@/planning/tax-profile";
import { firstSentence } from "./popups";
import { taxesSource } from "./sources/taxes";
import type { Snapshot } from "./snapshot";

// Debug 2 (11-16, one month of Wells Fargo checking, the dock at 1280 light): the tax profile card
// read "Let's get your taxes ready." with the buttons "That's all of it" and "Not now" under it;
// the question they answered ("…your income for 2026 looks like wages… Is that all of it?") was
// behind More details. A card shows its first sentence, so the question comes first.

const found = findTaxFacts({
  transactions: [1, 15].map((d) => ({
    date: `2026-10-${String(d).padStart(2, "0")}`,
    amountCents: -71_250,
    pfcDetailed: "INCOME_SALARY",
    description: "CAMPUS DINING PAYROLL",
    merchantName: null,
  })),
  accounts: [],
  settingsState: null,
  newBaby: false,
});
const view = (s: Partial<StoredTaxProfile> | null) =>
  taxProfileView(
    s && {
      filingStatus: null,
      childrenUnder17: null,
      otherDependants: null,
      state: null,
      incomeKinds: [],
      answered: [],
      ...s,
    },
    found,
  );
const context = {
  now: new Date("2026-11-16T08:00:00Z"),
  local: { date: "2026-11-16", hour: 0 },
  trigger: "open" as const,
};
const headline = (profile: ReturnType<typeof view>) =>
  firstSentence(taxesSource.gather({ tax: { profile } } as Snapshot, context)[0].body);

describe("the tax profile card's headline", () => {
  it("is the question about the income Jane found", () => {
    expect(headline(view(null))).toMatch(/^From your accounts, your income for 2026 looks like /);
  });

  it("is the filing question once the income is answered", () => {
    expect(headline(view({ incomeKinds: ["w2"], answered: ["incomeKinds"] }))).toBe(
      "How will you file for 2026?",
    );
  });
});
