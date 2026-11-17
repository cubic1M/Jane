import { describe, expect, it } from "vitest";
import type { Charge, Recurring } from "./recurring";
import { costReply } from "./recurring-replies";

// Debug 2, third desktop sweep (11-16, upload S1): "how much is my rent?" answered "Sunset Villas
// Rent is $725.00 a month, $8,700.00 a year. The next charge is Dec 1 (in 15 days)." with "Open
// subscriptions". Rent isn't one: a regular bill that isn't a subscription opens the bills.

const charge = (over: Partial<Charge>): Charge => ({
  key: "merchant:sunset villas rent",
  merchantKey: "sunset villas rent",
  merchant: "Sunset Villas Rent",
  frequency: "MONTHLY",
  lastAmountCents: 72_500,
  lastDate: "2026-11-01",
  nextDate: "2026-12-01",
  annualCostCents: 870_000,
  subscription: false,
  maybeSubscription: false,
  openFindingId: null,
  ...over,
});
const recurring = (c: Charge): Recurring => ({ charges: [c], nextIncome: null });

describe("what a regular charge's answer opens", () => {
  it("is the bills for rent", () => {
    const reply = costReply(
      { target: "rent", year: false },
      recurring(charge({})),
      null,
      "2026-11-16",
    );
    expect(reply?.actions).toEqual([
      expect.objectContaining({ label: "See your bills", href: "/bills" }),
    ]);
  });

  it("is still the subscriptions for a subscription", () => {
    const reply = costReply(
      { target: "spotify", year: false },
      recurring(charge({ merchant: "Spotify", merchantKey: "spotify", subscription: true })),
      null,
      "2026-11-16",
    );
    expect(reply?.actions.map((a) => a.label)).toEqual(["Open subscriptions"]);
  });
});
