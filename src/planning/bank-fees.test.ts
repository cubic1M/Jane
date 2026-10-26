import { describe, expect, it } from "vitest";
import { bankFeesYear, type FeeTx } from "./bank-fees";

const fee = (date: string, amountCents: number, pfc = "BANK_FEES_OVERDRAFT_FEES"): FeeTx => ({
  date,
  amountCents,
  description: amountCents > 0 ? "OVERDRAFT FEE" : "OVERDRAFT FEE REVERSAL",
  pfc,
});

describe("bankFeesYear", () => {
  it("counts fees over a year, scaled up from fewer months", () => {
    expect(bankFeesYear([fee("2026-09-24", 3400)], 3)).toEqual({
      seenCents: 3400,
      yearCents: 13_600,
      count: 1,
      monthsOfData: 3,
      estimated: true,
    });
  });

  it("leaves out a fee the bank gave back (messy-bank QA)", () => {
    const foreign = fee("2026-08-02", 128, "BANK_FEES_FOREIGN_TRANSACTION_FEES");
    expect(bankFeesYear([fee("2026-09-24", 3400), fee("2026-09-26", -3400), foreign], 3)).toEqual({
      seenCents: 128,
      yearCents: 512,
      count: 1,
      monthsOfData: 3,
      estimated: true,
    });
    expect(bankFeesYear([fee("2026-09-24", 3400), fee("2026-09-26", -3400)], 3)).toBeNull();
  });

  it("gives back one fee per reversal, and only within FEE_REVERSAL_DAYS", () => {
    const twoFeesOneBack = [
      fee("2026-09-24", 3400),
      fee("2026-09-25", 3400),
      fee("2026-09-26", -3400),
    ];
    expect(bankFeesYear(twoFeesOneBack, 12)).toMatchObject({ seenCents: 3400, count: 1 });
    // A refund months later is still money back, but not a reversal of that fee.
    const late = [fee("2026-01-10", 3400), fee("2026-05-01", -3400), fee("2026-07-01", 3400)];
    expect(bankFeesYear(late, 12)).toMatchObject({ seenCents: 3400, count: 2 });
  });

  it("takes a partial refund off the total", () => {
    expect(bankFeesYear([fee("2026-09-24", 3400), fee("2026-09-26", -1700)], 12)).toMatchObject({
      seenCents: 1700,
      count: 1,
    });
  });
});
