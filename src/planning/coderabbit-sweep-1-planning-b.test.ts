import { describe, expect, it } from "vitest";
import type { TransferOffer } from "@/lib/lenders/partner";
import { BT_CARD } from "@/lib/connectors/card-offers/__fixtures__/engine-offers";
import { parseCardOffer } from "@/lib/connectors/card-offers/offer";
import { parseAffordQuery } from "./afford-query";
import { auditPackCsv, type AuditItem } from "./audit-records";
import { decideContribution } from "./auto-invest";
import { scoreTransfer } from "./balance-transfer";
import { installments, newPlanStrain } from "./bnpl";
import { provenSame } from "./books";
import { promoPlan } from "./card-interest";
import { scoreCardTransfer } from "./card-transfer";
import { LOW_BALANCE_CUSHION_CENTS } from "@/config/detection";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 1: each case is a finding
// reproduced against the code first (failing), then fixed.

describe("books: the proof that two accounts are the same", () => {
  const tx = (id: string, date: string, amountCents = 1_000, description = "COFFEE") => ({
    id,
    date,
    amountCents,
    description,
    accountId: "a",
    pfcPrimary: null,
  });
  it("proves nothing when the two sides' dates never overlap", () => {
    const result = provenSame([tx("k1", "2026-11-01")], [tx("d1", "2026-10-01")]);
    expect(result.ok).toBe(false);
    // The older ones are still listed, to be moved.
    expect(result.extra).toHaveLength(1);
  });
  it("counts identical transactions one to one", () => {
    const keep = [tx("k1", "2026-11-01"), tx("k2", "2026-11-01")];
    expect(provenSame(keep, [tx("d1", "2026-11-01")]).ok).toBe(false);
    expect(provenSame(keep, [tx("d1", "2026-11-01"), tx("d2", "2026-11-01")]).ok).toBe(true);
  });
});

describe("buy now, pay later", () => {
  const plan = (over: object) => ({
    key: "p",
    name: "Pay later",
    paymentCents: 10_000,
    every: "month" as const,
    nextDue: "2027-01-31",
    balanceCents: null,
    ...over,
  });
  it("keeps the February payment of a plan due on the 31st", () => {
    const list = installments([plan({})], "2027-01-01", "2027-02-28");
    expect(list.map((i) => i.date)).toEqual(["2027-01-31", "2027-02-28"]);
  });
  it("makes the last payment of a plan with a known balance what is left", () => {
    const list = installments(
      [plan({ every: "two_weeks", nextDue: "2026-11-24", balanceCents: 25_000 })],
      "2026-11-24",
      "2027-01-31",
    );
    expect(list.map((i) => i.cents)).toEqual([10_000, 10_000, 5_000]);
  });
  it("is strained when the plan takes a later day under the cushion", () => {
    // Nov 24 is already under the cushion (the global low); Nov 25 is above it until the plan.
    const days = [
      { date: "2026-11-24", balanceCents: LOW_BALANCE_CUSHION_CENTS - 5_000 },
      { date: "2026-11-25", balanceCents: LOW_BALANCE_CUSHION_CENTS + 2_000 },
    ];
    const strain = newPlanStrain(days, {
      totalCents: 4_000,
      installments: 1,
      everyDays: 14,
      firstDate: "2026-11-25",
    });
    expect(strain?.lowestWith.balanceCents).toBe(LOW_BALANCE_CUSHION_CENTS - 5_000);
    expect(strain?.strained).toBe(true);
  });
});

describe("card interest: a promotion that has ended", () => {
  it("costs interest on the balance still unpaid, not on a payment not yet made", () => {
    const plan = promoPlan({
      balanceCents: 100_000,
      startedOn: "2025-11-24",
      endsOn: "2026-11-24",
      goToAprBps: 2_400,
      deferred: false,
      monthlyPaidCents: 100_000,
      asOf: "2026-11-24",
    });
    expect(plan.ended).toBe(true);
    expect(plan.costIfMissedCents).toBeGreaterThan(0);
  });
});

describe("card transfer", () => {
  const base = { balanceCents: 500_000, aprBps: 2_499, payCents: 30_000, asOf: "2026-11-06" };
  it("says the annual fee isn't stated rather than 'no annual fee'", () => {
    const offer = { ...parseCardOffer(BT_CARD), annualFeeCents: null };
    const result = scoreCardTransfer({ ...base, offer });
    if (!result.show) throw new Error("expected a transfer");
    expect(result.lines.join(" ")).not.toMatch(/no annual fee/);
    expect(result.lines.join(" ")).toMatch(/annual fee not stated/);
  });
  it("still says no annual fee when the offer says zero", () => {
    const offer = { ...parseCardOffer(BT_CARD), annualFeeCents: 0 };
    const result = scoreCardTransfer({ ...base, offer });
    if (!result.show) throw new Error("expected a transfer");
    expect(result.lines.join(" ")).toMatch(/no annual fee/);
  });
  it("sizes the payment that clears a too-slow transfer with its intro interest", () => {
    const offer = {
      ...parseCardOffer(BT_CARD),
      transferFeeBps: 0,
      transferFeeMinCents: 0,
      introTransferMonths: 12,
      introTransferAprBps: 1_200,
    };
    const result = scoreCardTransfer({
      balanceCents: 120_000,
      aprBps: 2_499,
      payCents: 5_000,
      offer,
      asOf: "2026-11-06",
    });
    if (result.show || result.reason !== "too_slow") throw new Error("expected too_slow");
    // $1,200 over 12 months at 12% is $106.62 a month, not $100.
    expect(result.paymentCents).toBeGreaterThan(10_000);
    expect(result.paymentCents).toBe(10_662);
  });
});

describe("balance transfer: when the 0% ends", () => {
  it("clamps to the end of a short month", () => {
    const offer: TransferOffer = {
      id: "o",
      issuer: "Issuer",
      cardName: "Card",
      promoMonths: 6,
      feeCents: 7_232,
      feeLabel: "3% transfer fee",
      goToAprBps: 2499,
      sourceUrl: "https://example.com",
      demo: true,
    };
    expect(scoreTransfer(241_050, 2299, offer, "2026-08-31").promoEndsOn).toBe("2027-02-28");
  });
});

describe("auto-invest: why a contribution is paused", () => {
  it("names the minimum when there is room but the fixed amount is under it", () => {
    const result = decideContribution({ mode: "fixed", amountCents: 1_000, safeCents: 500_000 });
    expect(result.status).toBe("paused");
    if (result.status === "paused") {
      expect(result.reason).not.toMatch(/Safe to spend is/);
      expect(result.reason).toMatch(/minimum/);
    }
  });
});

describe("audit pack CSV", () => {
  it("writes a negative amount as a number, and still guards text cells", () => {
    const item: AuditItem = {
      key: "i",
      label: "=SUM(A1)",
      claimedCents: 5_000,
      evidence: [
        {
          kind: "transaction",
          id: "t",
          date: "2026-03-01",
          payee: "Refund",
          cents: -1_234,
          receipt: false,
        },
      ],
      needs: [],
    };
    const csv = auditPackCsv({ year: 2026, items: [item], gaps: [], incomplete: [] });
    expect(csv).toContain(",-12.34\r\n");
    expect(csv).not.toContain("'-12.34");
    expect(csv).toContain("'=SUM(A1)");
  });
});

describe("afford: a date that doesn't exist", () => {
  it("rejects February 31", () => {
    const query = parseAffordQuery({ amount: "100", date: "2027-02-31" }, "2027-01-10");
    expect(query.change).toBeNull();
    expect(query.error).not.toBeNull();
    expect(parseAffordQuery({ amount: "100", date: "2027-02-28" }, "2027-01-10").error).toBeNull();
  });
});
