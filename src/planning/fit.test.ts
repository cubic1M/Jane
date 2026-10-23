import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import {
  FIT_COMFORT_SHARE,
  FIT_CREDIT_FLOOR,
  FIT_MAX_OPTIONS,
  FIT_MIN_OPTIONS,
  FIT_NO_SCORE_EVIDENCE,
  FIT_OFFER_EVIDENCE,
  FIT_TERMS,
  FIT_TROUBLE_COMFORT_FACTOR,
} from "@/config/fit";
import { demoLender } from "@/lib/lenders/demo";
import type { LoanOffer } from "@/lib/lenders/partner";
import { inputFor } from "@/profile/sample";
import { fit, type FitInput, type FitPerson } from "./fit";
import { fitPersonFrom } from "./fit-person";

// Spec step 281: the fit engine, on the lender stand-in's offers and on made-up offers where
// the stand-in doesn't have the case.

const person = (over: Partial<FitPerson> = {}): FitPerson => ({
  creditScore: 720,
  incomeCents: 600_000,
  debtPaymentsCents: 60_000,
  cashCents: 1_000_000,
  debtTrouble: false,
  ...over,
});

async function offersFor(
  product: "auto" | "personal" | "mortgage",
  amountCents: number,
  creditBand: "excellent" | "good" | "fair" = "good",
): Promise<LoanOffer[]> {
  const out: LoanOffer[] = [];
  for (const termMonths of FIT_TERMS[product]) {
    out.push(
      ...(await demoLender.prequalify({
        product,
        amountCents,
        termMonths,
        creditBand,
        month: "2026-10",
      })),
    );
  }
  return out;
}
const car = async (p: FitPerson, extra: Partial<FitInput> = {}) =>
  fit({
    need: "car",
    product: "auto",
    amountCents: 2_000_000,
    person: p,
    offers: await offersFor("auto", 2_000_000),
    ...extra,
  });

describe("options for a new car loan", () => {
  it("shows two to four options with a pick, each with a one-line headline and the maths", async () => {
    const r = await car(person());
    expect(r.options.length).toBeGreaterThanOrEqual(FIT_MIN_OPTIONS);
    expect(r.options.length).toBeLessThanOrEqual(FIT_MAX_OPTIONS);
    expect(r.pick).toBe(r.options[0].id);
    expect(r.options[0].label).toBe("best_cost");
    for (const o of r.options) {
      expect(o.headline).toMatch(/^.+ \d+(\.\d+)?% - \$[\d,.]+ a month for \d+(\.\d)? yrs?$/);
      expect(o.details).toHaveLength(3);
      expect(o.details[2]).toMatch(/paid in all/);
    }
    expect(new Set(r.options.map((o) => o.id)).size).toBe(r.options.length);
  });

  it("picks on total cost with fees counted, not the lowest rate", () => {
    const offer = (id: string, aprBps: number, feeCents: number): LoanOffer => ({
      id,
      lender: id,
      product: "auto",
      aprBps,
      rateType: "fixed",
      termMonths: 60,
      feeCents,
      feeLabel: "fee",
      sourceUrl: "https://example.com",
      demo: false,
    });
    const r = fit({
      need: "car",
      product: "auto",
      amountCents: 1_000_000,
      person: person(),
      offers: [offer("lowrate", 500, 150_000), offer("cheap", 600, 0)],
    });
    expect(r.pick).toBe("cheap");
    const low = r.options.find((o) => o.id === "lowrate")!;
    const cheap = r.options.find((o) => o.id === "cheap")!;
    expect(low.totalCostCents).toBeGreaterThan(cheap.totalCostCents);
    expect(low.aprBps).toBeLessThan(cheap.aprBps);
    expect(low.details[2]).toContain("including $1,500.00 in fees");
  });

  it("marks a payment over a comfortable share and picks only from the comfortable ones", async () => {
    const r = await car(person({ incomeCents: 300_000, debtPaymentsCents: 0 }));
    const share = FIT_COMFORT_SHARE.auto;
    const pick = r.options.find((o) => o.id === r.pick)!;
    expect(pick.comfortable).toBe(true);
    expect(pick.paymentShare!).toBeLessThanOrEqual(share);
    for (const o of r.options.filter((x) => !x.comfortable)) {
      expect(o.paymentShare!).toBeGreaterThan(share);
    }
  });

  it("picks the lowest payment and says so when nothing is comfortable", async () => {
    const r = await car(person({ incomeCents: 150_000, debtPaymentsCents: 0 }));
    expect(r.options.every((o) => !o.comfortable)).toBe(true);
    const lowest = Math.min(...r.options.map((o) => o.paymentCents));
    expect(r.options.find((o) => o.id === r.pick)!.paymentCents).toBe(lowest);
    expect(r.assumptions.join(" ")).toContain("None of the options is comfortable");
  });
});

describe("the best loan's other terms, for a follow-up", () => {
  it("lists the best loan's lender at each term, with the differences against it worked out", async () => {
    const r = await car(person({ incomeCents: 400_000, debtPaymentsCents: 30_000 }));
    const best = r.options.find((o) => o.label === "best_cost")!;
    expect(r.terms!.lender).toBe(best.lender);
    expect(r.terms!.bestId).toBe(best.id);
    const months = r.terms!.options.map((t) => t.termMonths);
    expect(months).toEqual([...months].sort((a, b) => a - b));
    expect(months).toContain(best.termMonths);
    const at = r.terms!.options.find((t) => t.id === best.id)!;
    expect(at).toMatchObject({ paymentDiffCents: 0, interestDiffCents: 0 });
    expect(at.interestCents).toBe(best.totalCostCents - best.feeCents - 2_000_000);
    for (const t of r.terms!.options) {
      expect(t.paymentDiffCents).toBe(t.paymentCents - best.paymentCents);
      expect(t.interestDiffCents).toBe(t.interestCents - at.interestCents);
      // A shorter term pays more a month and less interest; a longer one the other way.
      if (t.termMonths < best.termMonths) {
        expect(t.paymentDiffCents).toBeGreaterThan(0);
        expect(t.interestDiffCents).toBeLessThan(0);
      }
      if (t.termMonths > best.termMonths) {
        expect(t.paymentDiffCents).toBeLessThan(0);
        expect(t.interestDiffCents).toBeGreaterThan(0);
      }
    }
    expect(months.some((m) => m < best.termMonths)).toBe(true);
  });

  it("has none when no loan is eligible", async () => {
    expect((await car(person({ creditScore: 400 }))).terms).toBeNull();
  });
});

describe("who is eligible", () => {
  it("turns a score under the floor down with the reason, and says what would help", async () => {
    const r = await car(person({ creditScore: FIT_CREDIT_FLOOR.auto - 20 }));
    expect(r.options).toEqual([]);
    expect(r.pick).toBeNull();
    expect(r.ineligible[0].reason).toBe(
      `Lenders usually want a score of ${FIT_CREDIT_FLOOR.auto} or more for this; yours is ${FIT_CREDIT_FLOOR.auto - 20}.`,
    );
    expect(r.whatWouldHelp[0]).toMatch(/^A score of 560 would open this up/);
  });

  it("turns down a payment that takes debt-to-income over the limit", async () => {
    const r = await car(person({ debtPaymentsCents: 380_000 }));
    expect(r.ineligible.length).toBeGreaterThan(0);
    expect(r.ineligible[0].reason).toMatch(
      /Your debt payments would be \d+% of your income, over the 50% lenders allow\./,
    );
    expect(r.whatWouldHelp.join(" ")).toMatch(/Paying down debt/);
  });

  it("needs an income to judge a payment against", async () => {
    const r = await car(person({ incomeCents: null }));
    expect(r.options).toEqual([]);
    expect(r.ineligible[0].reason).toBe("I can't see an income to judge the payment against.");
  });
});

describe("a refinance or a consolidation", () => {
  const baseline = {
    label: "your car loan",
    balanceCents: 1_280_000,
    aprBps: 1_790,
    monthlyCents: 46_000,
  };
  const refi = async (p: FitPerson, b = baseline) =>
    fit({
      need: "refinance",
      product: "auto",
      amountCents: b.balanceCents,
      person: p,
      offers: await offersFor("auto", b.balanceCents),
      baseline: b,
    });

  it("shows what each saves over keeping the loan, and picks the best saving", async () => {
    const r = await refi(person());
    const pick = r.options.find((o) => o.id === r.pick)!;
    expect(pick.savesCents!).toBeGreaterThan(100_000);
    expect(pick.headline).toMatch(/^.+ \d+(\.\d+)?% - \$[\d,.]+ less over \d+(\.\d)? yrs?$/);
    expect(pick.details.join(" ")).toContain("less than keeping your car loan");
    expect(r.options.some((o) => o.label === "keep")).toBe(true);
    expect(r.options.length).toBeLessThanOrEqual(FIT_MAX_OPTIONS + 1);
  });

  it("keeps what you have when no offer saves enough", async () => {
    const r = await refi(person(), { ...baseline, aprBps: 400, balanceCents: 1_000_000 });
    expect(r.pick).toBe("keep");
    expect(r.options.find((o) => o.id === "keep")!.headline).toMatch(
      /^Keep your car loan - \$460\.00 a month/,
    );
  });

  it("never steers someone in debt trouble to a bigger payment than they have", async () => {
    const r = await refi(person({ debtTrouble: true, incomeCents: 350_000 }));
    if (r.pick !== "keep") {
      const pick = r.options.find((o) => o.id === r.pick)!;
      expect(pick.paymentCents).toBeLessThanOrEqual(baseline.monthlyCents);
    }
    for (const o of r.options.filter((x) => x.comfortable && x.id !== "keep")) {
      expect(o.paymentShare!).toBeLessThanOrEqual(
        FIT_COMFORT_SHARE.auto * FIT_TROUBLE_COMFORT_FACTOR,
      );
    }
  });

  it("counts the fee against the saving and says when it pays back", async () => {
    const r = await refi(person());
    const withFee = r.options.find((o) => o.feeCents > 0 && o.breakEvenMonths !== null);
    if (withFee) expect(withFee.details.join(" ")).toMatch(/The fee pays back in \d+ months/);
  });
});

describe("how sure the pick is", () => {
  it("is capped by stand-in quotes, and lower still with no pulled score or thin income evidence", async () => {
    expect((await car(person())).confidence).toEqual({
      percent: FIT_OFFER_EVIDENCE.percent,
      reason: FIT_OFFER_EVIDENCE.reason,
    });
    expect((await car(person({ creditScore: null }))).confidence).toEqual({
      percent: FIT_NO_SCORE_EVIDENCE.percent,
      reason: FIT_NO_SCORE_EVIDENCE.reason,
    });
    const thin = await car(person(), { evidence: [{ percent: 55, reason: "2 months of income" }] });
    expect(thin.confidence).toEqual({ percent: 55, reason: "2 months of income" });
  });
});

describe("the eight sample people, for a $5,000 personal loan", () => {
  for (const p of PEOPLE) {
    it(`${p.name}: options with a pick, or the reasons nothing fits`, async () => {
      const input = inputFor(p.id);
      const who = fitPersonFrom(input);
      const r = fit({
        need: "personal",
        product: "personal",
        amountCents: 500_000,
        person: who,
        offers: await offersFor("personal", 500_000),
      });
      if (r.options.length === 0) {
        expect(r.ineligible.length).toBeGreaterThan(0);
        expect(r.pick).toBeNull();
        return;
      }
      expect(r.options.length).toBeGreaterThanOrEqual(1);
      expect(r.options.map((o) => o.id)).toContain(r.pick);
      const pick = r.options.find((o) => o.id === r.pick)!;
      if (who.debtTrouble) {
        // The person in trouble is only ever picked a payment inside the tighter share.
        expect(pick.comfortable || r.assumptions.join(" ").includes("None of the options")).toBe(
          true,
        );
      }
      expect(r.confidence!.percent).toBeLessThanOrEqual(FIT_OFFER_EVIDENCE.percent);
    });
  }
});

describe("paying off with cash, and what keeping costs", () => {
  const card = {
    label: "your card",
    balanceCents: 300_000,
    aprBps: 2_499,
    monthlyCents: 9_000,
  };
  const consolidate = async (p: FitPerson) =>
    fit({
      need: "consolidation",
      product: "personal",
      amountCents: card.balanceCents,
      person: p,
      offers: await offersFor("personal", card.balanceCents),
      baseline: card,
    });

  it("picks paying it off from cash when the cash covers it and still leaves a month of spending", async () => {
    const r = await consolidate(person({ cashCents: 900_000, spendCents: 250_000 }));
    expect(r.pick).toBe("payoff");
    expect(r.options[0]).toMatchObject({
      id: "payoff",
      label: "payoff",
      feeCents: 0,
      totalCostCents: 300_000,
    });
    expect(r.options[0].headline).toMatch(/^Pay off your card with your cash - \$[\d,.]+ less$/);
    expect(r.options[0].details[1]).toBe(
      "Leaves $6,000.00, your emergency cushion of $2,500.00 kept",
    );
    expect(r.options.length).toBeGreaterThan(1);
    expect(r.confidence).toEqual({
      percent: 90,
      reason: "your balances as your accounts show them",
    });
  });

  it("does not, when the cash would leave less than a month of spending", async () => {
    const r = await consolidate(person({ cashCents: 400_000, spendCents: 250_000 }));
    expect(r.options.some((o) => o.id === "payoff")).toBe(false);
    expect(r.pick).not.toBe("payoff");
  });

  it("still offers it when no loan is eligible", async () => {
    const r = await consolidate(
      person({ creditScore: 450, cashCents: 900_000, spendCents: 250_000 }),
    );
    expect(r.options.map((o) => o.id)).toEqual(["payoff"]);
    expect(r.pick).toBe("payoff");
    expect(r.ineligible.length).toBeGreaterThan(0);
  });

  it("costs keeping a card by the months its payment really takes, not a made-up term", async () => {
    const r = await consolidate(person({ cashCents: 100_000, spendCents: 250_000 }));
    const keep = r.options.find((o) => o.id === "keep");
    if (keep) expect(keep.termMonths).toBeGreaterThan(36);
    const loan = r.options.find((o) => o.id !== "keep")!;
    expect(loan.savesCents!).toBeGreaterThan(0);
  });
});

describe("when nothing is comfortable", () => {
  it("labels the lowest payment as such, not as the best total cost", async () => {
    const r = await car(person({ incomeCents: 150_000, debtPaymentsCents: 0 }));
    expect(r.options[0].label).toBe("lowest_payment");
    expect(r.options.some((o) => o.label === "best_cost")).toBe(false);
  });
});

// Spec step 249: a loan co-signed for someone is the person's own debt to a lender.
describe("a co-signed loan", () => {
  it("counts its payment in the person's own debt-to-income", async () => {
    const input = inputFor("family");
    const before = fitPersonFrom(input);
    const after = fitPersonFrom({
      ...input,
      familyCredit: {
        helped: 0,
        cosignedOwedCents: 1_800_000,
        cosignedMissed: 0,
        cosignedPaymentCents: 250_000,
      },
    });
    expect(after.debtPaymentsCents - before.debtPaymentsCents).toBe(250_000);
    // Enough co-signed debt pushes a loan the person could get past the lender's limit.
    const offers = await offersFor("personal", 500_000);
    const fits = (who: FitPerson) =>
      fit({ need: "personal", product: "personal", amountCents: 500_000, person: who, offers });
    const heavy = fitPersonFrom({
      ...input,
      familyCredit: {
        helped: 0,
        cosignedOwedCents: 30_000_000,
        cosignedMissed: 0,
        cosignedPaymentCents: 2_000_000,
      },
    });
    expect(fits(before).options.length).toBeGreaterThan(0);
    expect(fits(heavy).options).toEqual([]);
    expect(fits(heavy).ineligible[0].reason).toMatch(/debt payments would be/);
  });
});
