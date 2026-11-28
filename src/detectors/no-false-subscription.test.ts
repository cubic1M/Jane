import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { merchantKeyOf, recurringRowsOf } from "./recurring-source";
import { DETECTORS, runDetectors, type Suggestion } from "./index";

// Founder 11-28, on his own real account: "Cancel a trial now billing you, saving $34 a year" and
// "Starbucks started with a small trial charge and now costs $11.30", from two coffees bought
// a year apart. A card that says a charge is a subscription, a trial turned billing or a recurring
// charge may name only a merchant the Subscriptions and regular bills page lists.

const TODAY = "2026-11-12";
const CHECKING = { id: "chk", name: "Checking", type: "depository", subtype: "checking" };

type Tx = { date: string; cents: number; name: string; pfc: string; merchant?: string };

function dataOf(txs: readonly Tx[]): ProfileInput {
  const base = inputFor("renter");
  return {
    ...base,
    today: TODAY,
    accounts: [{ ...CHECKING, balanceCents: 250_000 }],
    transactions: txs.map((t) => ({
      date: t.date,
      amountCents: t.cents,
      description: t.name,
      pfc: t.pfc,
      accountId: "chk",
      merchantName: t.merchant ?? null,
    })),
  };
}

const fired = (data: ProfileInput): Suggestion[] =>
  runDetectors({ profile: buildProfile(data), data }, DETECTORS);

// A card about a subscription, a trial or a charge that recurs.
const SUBSCRIPTION_WORDS = /subscri|trial|recurr|renew|price rise|a charge went up/i;
const aboutRecurring = (cards: Suggestion[]) =>
  cards.filter(
    (c) =>
      c.capability === "subscriptions" ||
      SUBSCRIPTION_WORDS.test(`${c.title} ${c.headline} ${c.short} ${c.why}`),
  );

const COFFEE = "FOOD_AND_DRINK_COFFEE";
const STARBUCKS: Tx[] = [
  {
    date: "2025-12-02",
    cents: 150,
    name: "STARBUCKS STORE 12345",
    pfc: COFFEE,
    merchant: "Starbucks",
  },
  {
    date: "2026-11-05",
    cents: 1130,
    name: "STARBUCKS STORE 12345",
    pfc: COFFEE,
    merchant: "Starbucks",
  },
];

describe("two coffees a year apart are not a subscription", () => {
  it("the founder's Starbucks: no subscription, trial or price card, and nothing in the totals", () => {
    const data = dataOf(STARBUCKS);
    expect(recurringRowsOf(data)).toEqual([]);
    const cards = fired(data);
    expect(aboutRecurring(cards).map((c) => c.topic)).toEqual([]);
    expect(JSON.stringify(cards)).not.toMatch(/starbucks/i);
  });

  it("the trial rule alone says nothing", () => {
    const data = dataOf(STARBUCKS);
    const trial = DETECTORS.find((d) => d.topic === "trial_conversion")!;
    expect(trial.detect({ profile: buildProfile(data), data })).toBeNull();
  });
});

// The last paid charge is October 14: still billing on the 12th of November.
const month = (m: number) => `2026-${String(m).padStart(2, "0")}-14`;
const STREAMING = (first: number, n: number): Tx[] => [
  {
    date: month(10 - n),
    cents: first,
    name: "NETFLIX.COM",
    pfc: "ENTERTAINMENT_TV_AND_MOVIES",
    merchant: "Netflix",
  },
  ...Array.from({ length: n }, (_, i) => ({
    date: month(10 - n + 1 + i),
    cents: 1_299,
    name: "NETFLIX.COM",
    pfc: "ENTERTAINMENT_TV_AND_MOVIES",
    merchant: "Netflix",
  })),
];

describe("a real trial still shows", () => {
  it("$1 then $12.99 monthly for four months: one trial card, a yearly figure at its monthly cadence", () => {
    const cards = fired(dataOf(STREAMING(100, 4)));
    const trial = cards.find((c) => c.topic === "trial_conversion");
    expect(trial).toBeDefined();
    // By hand: 12 charges a year at $12.99 = $155.88, not a guess from the days between charges.
    expect(trial!.worthCents).toBe(15_588);
    expect(trial!.why).toContain("started with a small trial charge and now costs $12.99");
  });

  it("says what Jane noticed, never tells a real account to cancel", () => {
    const trial = fired(dataOf(STREAMING(100, 4))).find((c) => c.topic === "trial_conversion")!;
    for (const text of [trial.title, trial.headline, trial.short, trial.why]) {
      expect(
        checkGuardrails(
          text,
          dollarFigures(text).map((f) => f.cents),
        ),
        text,
      ).toEqual({ ok: true });
      expect(tellsThemToAct(text), text).toBe(false);
      expect(text, text).not.toMatch(/\b(?:switch|cancel|drop|move)\b/i);
    }
  });

  it("one paid charge after the trial is not yet a cadence", () => {
    const cards = fired(dataOf(STREAMING(100, 1)));
    expect(cards.find((c) => c.topic === "trial_conversion")).toBeUndefined();
  });
});

describe("the trap person: only the real cards appear", () => {
  const trap: Tx[] = [
    ...STARBUCKS,
    // Three irregular restaurant visits.
    { date: "2026-01-09", cents: 4_200, name: "CHIPOTLE 1234", pfc: "FOOD_AND_DRINK_RESTAURANT" },
    { date: "2026-04-30", cents: 5_100, name: "CHIPOTLE 1234", pfc: "FOOD_AND_DRINK_RESTAURANT" },
    { date: "2026-10-11", cents: 700, name: "CHIPOTLE 1234", pfc: "FOOD_AND_DRINK_RESTAURANT" },
    // Two annual-looking purchases 11 months apart at a retailer.
    {
      date: "2025-12-03",
      cents: 9_900,
      name: "BEST BUY 0042",
      pfc: "GENERAL_MERCHANDISE_ELECTRONICS",
    },
    {
      date: "2026-11-03",
      cents: 9_900,
      name: "BEST BUY 0042",
      pfc: "GENERAL_MERCHANDISE_ELECTRONICS",
    },
    // A refund then a re-purchase.
    {
      date: "2026-08-02",
      cents: 1_999,
      name: "ZAPPOS",
      pfc: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    },
    {
      date: "2026-08-09",
      cents: -1_999,
      name: "ZAPPOS",
      pfc: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    },
    {
      date: "2026-09-20",
      cents: 1_999,
      name: "ZAPPOS",
      pfc: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    },
    // A real trial, then monthly.
    ...STREAMING(100, 4),
  ];

  it("a trial card for the streaming service only; nothing names a shop", () => {
    const data = dataOf(trap);
    const cards = aboutRecurring(fired(data));
    expect(JSON.stringify(cards)).not.toMatch(/starbucks|chipotle|best buy|zappos/i);
    expect(cards.filter((c) => c.topic === "trial_conversion")).toHaveLength(1);
    expect(recurringRowsOf(data).map((r) => r.merchantKey)).toEqual(["netflix"]);
  });
});

describe("every subscription-type card names a merchant on the person's list", () => {
  it.each(PEOPLE.map((p) => p.id))("%s", (id) => {
    const data = inputFor(id);
    const listed = new Set(recurringRowsOf(data).map((r) => r.merchantKey));
    const cards = fired(data).filter((c) =>
      ["trial_conversion", "duplicate_subscription", "price_increase"].includes(c.topic),
    );
    for (const card of cards) {
      const payees =
        (card.watch as { payees?: { description: string }[] } | undefined)?.payees ?? [];
      expect(payees.length, `${id} ${card.topic}`).toBeGreaterThan(0);
      for (const p of payees) {
        const t = data.transactions.find((x) => x.description === p.description)!;
        expect(listed.has(merchantKeyOf(t)), `${id}: ${p.description}`).toBe(true);
      }
    }
  });
});

describe("the cadence holds across a month end and the year end", () => {
  // A trial on the 31st, then billed on the last day of each month: the same figure whichever side
  // of the month or year end "today" falls.
  const monthly = (todayOf: string, last: readonly string[]): ProfileInput => ({
    ...dataOf(
      last.map((date, i) => ({
        date,
        cents: i === 0 ? 100 : 1_299,
        name: "NETFLIX.COM",
        pfc: "ENTERTAINMENT_TV_AND_MOVIES",
        merchant: "Netflix",
      })),
    ),
    today: todayOf,
  });

  it.each([
    ["2026-01-31", ["2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31"]],
    ["2026-02-01", ["2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-01"]],
    ["2027-01-02", ["2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31", "2027-01-01"]],
  ])("on %s", (today, dates) => {
    const trial = fired(monthly(today, dates)).find((c) => c.topic === "trial_conversion");
    expect(trial?.worthCents).toBe(15_588);
  });
});
