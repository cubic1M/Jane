import { describe, expect, it } from "vitest";
import { BT_MIN_SAVING_CENTS, BT_REMIND_DAYS } from "@/config/debt";
import type { Debt } from "@/insights/debts";
import { demoTransfers } from "@/lib/lenders/demo";
import type { TransferOffer } from "@/lib/lenders/partner";
import { payoffPlan } from "./debt";
import { compareTransfers, daysUntil, dueReminder, scoreTransfer } from "./balance-transfer";

const AS_OF = "2026-10-19";
const offer = (over: Partial<TransferOffer>): TransferOffer => ({
  id: "o",
  issuer: "Issuer",
  cardName: "Card",
  promoMonths: 18,
  feeCents: 7_232,
  feeLabel: "3% transfer fee",
  goToAprBps: 2499,
  sourceUrl: "https://example.com",
  demo: true,
  ...over,
});
const CARD = {
  key: "account:card",
  kind: "card",
  name: "Demo Credit Card",
  balanceCents: 241_050,
  aprBps: 2299,
} as Debt;

describe("a 0% balance transfer", () => {
  it("clears the balance and the fee before the 0% ends", () => {
    const s = scoreTransfer(241_050, 2299, offer({}), AS_OF);
    expect(s.monthlyNeededCents).toBe(Math.ceil((241_050 + 7_232) / 18));
    expect(s.monthlyNeededCents * 18).toBeGreaterThanOrEqual(241_050 + 7_232);
    expect(s.promoEndsOn).toBe("2028-04-19");
  });

  it("always counts the fee against the interest it saves", () => {
    const s = scoreTransfer(241_050, 2299, offer({}), AS_OF);
    const keep = payoffPlan(
      [
        {
          id: "c",
          name: "c",
          balanceCents: 241_050,
          aprBps: 2299,
          minimumCents: s.monthlyNeededCents,
        },
      ],
      s.monthlyNeededCents,
      "avalanche",
    );
    expect(s.keepInterestCents).toBe(keep.ok ? keep.totalInterestCents : -1);
    expect(s.savingCents).toBe(s.keepInterestCents! - 7_232);
    // A bigger fee is counted in full too.
    const costly = scoreTransfer(241_050, 2299, offer({ feeCents: 20_000 }), AS_OF);
    expect(costly.savingCents).toBe(costly.keepInterestCents! - 20_000);
  });

  it("picks the best saving only when it's worth it, and says why", () => {
    const c = compareTransfers(
      CARD,
      [
        offer({ id: "a", cardName: "A" }),
        offer({ id: "b", cardName: "B", feeCents: 0, promoMonths: 12 }),
      ],
      AS_OF,
    )!;
    expect(c.offers[0].savingCents).toBeGreaterThanOrEqual(c.offers[1].savingCents!);
    expect(c.pick?.offer.id).toBe(c.offers[0].offer.id);
    expect(c.why).toHaveLength(3);
    expect(c.why[2]).toBe(
      "After the 0% it's 24.99%, so what's left then costs more. I'll remind you before.",
    );
    // A fee that eats the saving: no pick.
    const costly = compareTransfers(CARD, [offer({ feeCents: 1_000_000 })], AS_OF)!;
    expect(costly.offers[0].savingCents!).toBeLessThan(BT_MIN_SAVING_CENTS);
    expect(costly.pick).toBeNull();
  });

  it("only compares cards that charge interest", () => {
    expect(compareTransfers({ ...CARD, kind: "auto" } as Debt, [offer({})], AS_OF)).toBeNull();
    expect(compareTransfers({ ...CARD, aprBps: 0 } as Debt, [offer({})], AS_OF)).toBeNull();
  });

  it("reminds 60, 30 and 7 days before the 0% ends, each once", () => {
    const end = "2028-04-19";
    expect(dueReminder("2028-01-01", end, BT_REMIND_DAYS)).toBeNull();
    expect(dueReminder("2028-02-19", end, BT_REMIND_DAYS)).toBe(60);
    expect(dueReminder("2028-03-25", end, BT_REMIND_DAYS)).toBe(30);
    expect(dueReminder("2028-04-12", end, BT_REMIND_DAYS)).toBe(7);
    expect(dueReminder("2028-04-19", end, BT_REMIND_DAYS)).toBe(7);
    expect(dueReminder("2028-04-20", end, BT_REMIND_DAYS)).toBeNull();
    expect(daysUntil("2028-04-12", end)).toBe(7);
  });
});

describe("the stand-in 0% cards", () => {
  it("quote the fee on the amount, with its minimum, and skip amounts over the limit", () => {
    const offers = demoTransfers({ amountCents: 241_050, creditBand: "good", month: "2026-10" });
    expect(offers.map((o) => [o.cardName, o.feeCents])).toEqual([
      ["Lumen 0% Transfer Card", 7_232],
      ["Northstar Slate", 12_053],
      ["Beacon Intro", 0],
    ]);
    expect(
      demoTransfers({ amountCents: 100, creditBand: "good", month: "2026-10" })[0].feeCents,
    ).toBe(500);
    expect(
      demoTransfers({ amountCents: 1_000_000, creditBand: "good", month: "2026-10" }).map(
        (o) => o.cardName,
      ),
    ).not.toContain("Beacon Intro");
  });
});
