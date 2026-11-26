import { describe, expect, it } from "vitest";
import type { DebtTrouble } from "@/lib/debt-trouble";
import { headline } from "./debt-trouble-replies";

// "40% is over the 40% mark" read as a mistake (CodeRabbit sweep part 2, chunk root-05).

const trouble = (share: number, over: boolean) =>
  ({
    monthlyPaymentsCents: Math.round(share * 400_000),
    incomeCents: 400_000,
    share,
    over,
    reason: "payment_share",
    cardDebtCents: 0,
    debts: [],
  }) as unknown as DebtTrouble;

describe("the debt-share headline", () => {
  it("shows a tenth of a percent when the share rounds to the mark itself", () => {
    const text = headline(trouble(0.401, true));
    expect(text).toContain("40.1%");
    expect(text).toContain("over the 40% mark");
  });

  it("keeps whole percents when they differ from the mark", () => {
    expect(headline(trouble(0.52, true))).toContain("52% of your");
  });
});
