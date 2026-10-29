import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { INSURANCE_DETECTORS } from "@/detectors/insurance";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { toldFromFacts, type KnownFact } from "./facts";
import { cardHabitFrom, factsFromData, paydayFrom, rentPayeeFrom } from "./from-data";

// What an upload or the scan teaches Jane, and the detectors using what it knows.

const TODAY = "2026-10-20";
const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});
const input = (transactions: ProfileTx[], credit = false): ProfileInput => ({
  today: TODAY,
  transactions,
  accounts: [
    {
      id: "chk",
      name: "Checking",
      type: "depository",
      subtype: "checking",
      balanceCents: 100_000,
      balanceKnown: true,
      limitCents: null,
    },
    ...(credit
      ? [
          {
            id: "card",
            name: "Card",
            type: "credit",
            subtype: "credit card",
            balanceCents: 50_000,
            balanceKnown: true,
            limitCents: null,
          },
        ]
      : []),
  ],
  liabilities: [],
  told: {},
});

const pay = (date: string) => tx(date, -250_000, "ACME PAYROLL", "INCOME_SALARY");
const rent = (date: string) => tx(date, 180_000, "GREYSTAR PROPERTIES", "RENT_AND_UTILITIES_RENT");

describe("facts from the data", () => {
  it("finds the paydays when paychecks land on the same days", () => {
    const paychecks = ["07-01", "07-15", "08-01", "08-14", "09-01", "09-15", "10-01", "10-15"];
    expect(paydayFrom(input(paychecks.map((d) => pay(`2026-${d}`))))).toEqual({
      days: [1, 15],
      matches: 8,
    });
    // Every two weeks lands on a different day each month: no payday by the month.
    const biweekly = ["07-03", "07-17", "07-31", "08-14", "08-28", "09-11", "09-25", "10-09"];
    expect(paydayFrom(input(biweekly.map((d) => pay(`2026-${d}`))))).toBeNull();
    expect(paydayFrom(input([pay("2026-10-01")]))).toBeNull();
  });

  it("finds where the rent goes and how the cards are used", () => {
    const data = input([rent("2026-08-01"), rent("2026-09-01"), rent("2026-10-01")], true);
    expect(rentPayeeFrom(data)).toEqual({ name: "GREYSTAR PROPERTIES", matches: 3 });
    expect(cardHabitFrom(data)).toEqual({ carries: false, matches: 0 });
    const interest = tx("2026-10-05", 2_300, "INTEREST CHARGE", "BANK_FEES_INTEREST_CHARGE");
    expect(cardHabitFrom(input([interest], true))).toEqual({ carries: true, matches: 1 });
    expect(cardHabitFrom(input([interest]))).toBeNull();
  });

  it("learns nothing from an empty account, and no 'no' from too little data", () => {
    const empty = input([]);
    expect(factsFromData(buildProfile(empty), empty, { source: "upload" })).toEqual([]);
    // One month of paychecks: no car payments yet doesn't mean no car.
    const month = input([pay("2026-10-01"), pay("2026-10-15")]);
    const drafts = factsFromData(buildProfile(month), month, { source: "upload" });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.filter((d) => d.value === false)).toEqual([]);
  });

  it("remembers only what was seen, never what was told or a sensitive fact", () => {
    const data = inputFor("family", { housing: "rent" });
    const profile = buildProfile(data);
    const drafts = factsFromData(profile, data, { source: "detector", mainBank: "Chase" });
    const keys = drafts.map((d) => d.key);
    // Told, not seen: remembered where it was said, not as data.
    expect(keys).not.toContain("housing");
    expect(keys).not.toContain("health_costs");
    expect(keys).not.toContain("new_baby");
    expect(keys).toContain("income_pattern");
    expect(drafts.find((d) => d.key === "main_bank")).toMatchObject({
      value: "Chase",
      label: "Your main bank is Chase",
      source: "detector",
      sourceRef: "scan",
    });
    for (const d of drafts) {
      expect(d.label.length, d.key).toBeGreaterThan(0);
      expect(d.confidence, d.key).toBeGreaterThan(0);
    }
  });
});

describe("the detectors read what Jane knows", () => {
  const renters = INSURANCE_DETECTORS.find((d) => d.topic === "renters_insurance")!;
  // Paid every month, no rent or mortgage payments in the data, no home cover.
  const months = ["05", "06", "07", "08", "09", "10"];
  const fired = (told: ProfileInput["told"]) => {
    const data = { ...input(months.map((m) => pay(`2026-${m}-01`))), told };
    return renters.detect({ profile: buildProfile(data), data }) !== null;
  };
  const said = (over: Partial<KnownFact>): KnownFact => ({
    id: "f",
    key: "housing",
    value: "rent",
    label: "You rent your home",
    source: "chat",
    sourceRef: "jane_message:m1",
    confidence: 80,
    evidenceCount: 1,
    firstSeen: new Date(0),
    lastConfirmed: new Date(0),
    ...over,
  });

  it("offers renters cover once the person said in the chat that they rent", () => {
    // The payments don't show rent: nothing to offer from the data alone.
    expect(fired({})).toBe(false);
    expect(fired(toldFromFacts([said({})]))).toBe(true);
    // Something Jane isn't sure of isn't used, nor what it only read from data.
    expect(fired(toldFromFacts([said({ confidence: 40 })]))).toBe(false);
    expect(fired(toldFromFacts([said({ source: "detector" })]))).toBe(false);
  });
});
