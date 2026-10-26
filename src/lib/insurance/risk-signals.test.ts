import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { RISK_KINDS } from "@/config/insurance";
import { demoTransactions } from "@/data-sources/demo/demo-bank";
import { parseIntent } from "@/lib/jane-agent/intents";
import {
  gapQuotesLines,
  riskAnswerNote,
  riskQuestion,
} from "@/lib/jane-agent/insurance/risk-words";
import { coverageGaps } from "./gaps";
import type { Household } from "./household";
import { detectSignals, type SignalTransaction } from "./risk-signals";
import type { Risk } from "./risks";

// Risks seen in how they live (spec step 197): every signal is a rule, the demo bank has one
// of each, and each becomes one question. Plaid's sign: money in is negative. Pure.

const ASOF = "2026-10-19";
let n = 0;
const tx = (
  description: string,
  amountCents: number,
  date: string,
  merchantName: string | null = null,
): SignalTransaction => ({ id: `t${(n += 1)}`, date, amountCents, description, merchantName });

describe("each signal", () => {
  it("rideshare or delivery income is a payout from the company", () => {
    expect(
      detectSignals([tx("UBER DRIVER PAYOUT", -41_200, "2026-10-07", "Uber Driver")], ASOF),
    ).toEqual([
      {
        kind: "rideshare",
        merchant: "Uber Driver",
        amountCents: 41_200,
        date: "2026-10-07",
        transactionId: expect.any(String),
      },
    ]);
    for (const text of [
      "LYFT DRIVER EARNINGS",
      "DOORDASH DASHER PAYOUT",
      "INSTACART SHOPPER PAYOUT",
    ]) {
      expect(
        detectSignals([tx(text, -9_000, "2026-10-01")], ASOF).map((s) => s.kind),
        text,
      ).toEqual(["rideshare"]);
    }
  });
  it("is not a ride you took (money out)", () => {
    expect(detectSignals([tx("UBER *TRIP", 1_800, "2026-10-07", "Uber")], ASOF)).toEqual([]);
  });
  it("a home business is a payout from a shop or card reader", () => {
    expect(
      detectSignals([tx("SHOPIFY PAYOUT", -64_000, "2026-09-30", "Shopify")], ASOF)[0],
    ).toMatchObject({
      kind: "home_business",
    });
    expect(detectSignals([tx("ETSY.COM*GIFTS", 8_000, "2026-09-30", "Etsy")], ASOF)).toEqual([]);
  });
  it("a boat is spending at a marine store or marina", () => {
    expect(detectSignals([tx("WEST MARINE #112", 64_000, "2026-09-20")], ASOF)[0].kind).toBe(
      "boat",
    );
    expect(detectSignals([tx("SLIP FEES MARINA BAY", 40_000, "2026-09-20")], ASOF)[0].kind).toBe(
      "boat",
    );
  });
  it("renting the home out is a payout from a rental site", () => {
    expect(
      detectSignals([tx("AIRBNB PAYOUT", -115_000, "2026-10-12", "Airbnb")], ASOF)[0].kind,
    ).toBe("rental_out");
    expect(detectSignals([tx("AIRBNB * HMXYZ", 30_000, "2026-10-12")], ASOF)).toEqual([]);
  });
  it("a ring or a camera is a big purchase at a jeweler or camera store", () => {
    expect(
      detectSignals([tx("ZALES #2041", 248_000, "2026-10-10", "Zales")], ASOF)[0],
    ).toMatchObject({
      kind: "valuable",
      amountCents: 248_000,
    });
    expect(detectSignals([tx("B&H PHOTO", 150_000, "2026-10-10")], ASOF)[0].kind).toBe("valuable");
    // Cleaning the ring isn't buying one.
    expect(detectSignals([tx("ZALES #2041", 4_500, "2026-10-10")], ASOF)).toEqual([]);
  });
});

describe("a new dog", () => {
  const vet = tx("VCA ANIMAL HOSPITAL", 18_400, "2026-10-01");
  it("is a vet or pet-store charge with none for a good while before", () => {
    expect(detectSignals([vet], ASOF)[0].kind).toBe("new_dog");
  });
  it("is not asked for an old pet, or when a pet is already on the household", () => {
    expect(detectSignals([tx("PETCO #1043", 5_000, "2026-07-20"), vet], ASOF)).toEqual([]);
    expect(detectSignals([vet], ASOF, { knownPets: 1 })).toEqual([]);
  });
});

describe("timing", () => {
  it("only counts the last 60 days, and takes the newest transaction", () => {
    expect(detectSignals([tx("AIRBNB PAYOUT", -100_000, "2026-07-01")], ASOF)).toEqual([]);
    const both = detectSignals(
      [tx("AIRBNB PAYOUT", -100_000, "2026-09-01"), tx("AIRBNB PAYOUT", -120_000, "2026-10-10")],
      ASOF,
    );
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ amountCents: 120_000, date: "2026-10-10" });
  });
});

describe("the demo bank", () => {
  it("has one signal of each kind", () => {
    const anchor = "2026-10-18";
    const rows = demoTransactions({ seed: "abc123", anchor }, null, anchor).map((t) => ({
      id: t.transaction_id,
      date: t.date,
      // Plaid's amounts are dollars; money in is negative.
      amountCents: Math.round(t.amount * 100),
      description: t.name,
      merchantName: t.merchant_name ?? null,
    }));
    const signals = detectSignals(rows, anchor);
    expect(signals.map((s) => s.kind).sort()).toEqual([...RISK_KINDS].sort());
  });
});

describe("the gap a yes opens, and how Jane asks", () => {
  const household = (risks: Household["risks"]): Household => ({
    housing: { value: "own", from: "you" },
    vehicles: { value: 1, from: "you" },
    dependants: { value: 0, from: "you" },
    pets: { value: 0, from: "you" },
    dismissedGaps: [],
    signals: { paycheck: false, assetsCents: null, travelCents: 0, medicalCents: null },
    risks,
  });
  const gapKeys = (risks: Household["risks"]) =>
    coverageGaps(household(risks), [
      { id: "h", kind: "home", status: "active" },
      { id: "c", kind: "auto", status: "active", coverage: {} },
    ] as never).map((g) => g.key);

  it("opens one gap per yes, and nothing for a new dog (it adds a pet instead)", () => {
    expect(gapKeys(["rideshare", "boat", "new_dog"]).sort()).toEqual(["boat", "rideshare"]);
    expect(gapKeys(["rental_out", "valuable", "home_business"]).sort()).toEqual([
      "home_business",
      "short_term_rental",
      "valuables",
    ]);
    expect(gapKeys([])).toEqual([]);
  });

  const risk = (over: Partial<Risk>): Risk => ({
    id: "r1",
    kind: "rideshare",
    status: "asked",
    merchant: "Uber Driver",
    amountCents: 41_200,
    seenOn: "2026-10-07",
    ...over,
  });
  it("asks each as one question with what it saw", () => {
    expect(riskQuestion(risk({}))).toBe(
      "Are you driving for Uber? I saw $412.00 come in from Uber Driver on Oct 7. A personal car policy may not cover you while you drive for pay.",
    );
    expect(riskQuestion(risk({ kind: "new_dog", merchant: "VCA", amountCents: 18_400 }))).toMatch(
      /^Did you get a dog, or another pet\? I saw \$184\.00 went to VCA on Oct 7\./,
    );
    expect(riskAnswerNote("boat", false)).toBe("Okay, I won't ask about that again.");
    expect(riskAnswerNote("new_dog", true)).toContain("added a pet");
    expect(gapQuotesLines([])).toBe("I can't get prices for it right now.");
  });

  it("reads questions about what they might be missing", () => {
    for (const text of [
      "what risks do you see in my insurance",
      "what am I missing in my insurance",
    ]) {
      expect(parseIntent(text, ASOF), text).toMatchObject({ kind: "insurance", ask: "risks" });
    }
  });
});
