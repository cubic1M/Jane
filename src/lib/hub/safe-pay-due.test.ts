import { describe, expect, it } from "vitest";
import { CHECKING, input, tx } from "@/detection/__fixtures__/build";
import { addDays } from "@/detection/units";
import { safeReply } from "@/lib/jane-agent/replies";
import { safeToSpend } from "@/planning/safe-to-spend";
import { heroView, type HeroInput } from "./view";

// Phone debugger, 11-20 (Plaid sandbox): Blue Bottle pays $1,650 every two weeks, last on Nov 6.
// On Nov 20, before that day's deposit posted, Home said "Safe to spend until Dec 4: $1,150" without
// it. Pay due that hasn't come in is counted and said as expected, not in the balance; once the
// wait runs out it's said as not counted, rather than gone without a word.

const PAY = 165_000;
const paid = Array.from({ length: 8 }, (_, i) =>
  tx({
    date: addDays("2026-11-06", -14 * i),
    amountCents: -PAY,
    description: "BLUE BOTTLE COFFEE PAYROLL",
    merchantName: "Blue Bottle",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_SALARY",
  }),
);
const verizon = ["2026-08-25", "2026-09-25", "2026-10-25"].map((date) =>
  tx({ date, amountCents: 8_000, description: "VERIZON WIRELESS", merchantName: "Verizon" }),
);
const safeOn = (asOf: string) =>
  safeToSpend(
    input({
      asOf,
      accounts: [{ ...CHECKING, currentBalanceCents: 50_000 }],
      transactions: [...paid, ...verizon],
    }),
    { budgetsLeftCents: 0, goalsCents: 0 },
  );
const hero = (asOf: string): HeroInput => ({
  asOf,
  safe: safeOn(asOf),
  netWorth: null,
  foundCents: 0,
  savedCents: 0,
});
// The lines down to "=" add up to it.
const adds = (lines: { sign: string; cents: number }[]) => {
  const upTo = lines.slice(0, lines.findIndex((l) => l.sign === "=") + 1);
  const total = upTo.slice(0, -1).reduce((s, l) => s + (l.sign === "−" ? -l.cents : l.cents), 0);
  return [total, upTo.at(-1)!.cents];
};

describe("safe to spend on payday, before the pay comes in", () => {
  it("adds the pay as expected, not in yet, and runs to the next payday", () => {
    const view = heroView(hero("2026-11-20")).safe!;
    expect(view.label).toBe("Safe to spend until Dec 4");
    expect(view.cents).toBe(50_000 + PAY - 8_000);
    expect(view.why[1]).toMatchObject({
      label: "Blue Bottle pay due Nov 20, expected, not in yet",
      sign: "+",
      cents: PAY,
    });
    expect(view.why[1]!.note).toMatch(/isn't in your balance yet/);
    expect(view.why[0]).toEqual({ label: "In checking now", sign: "", cents: 50_000 });
    expect(view.steps[1]).toMatchObject({ label: view.why[1]!.label, sign: "+", cents: PAY });
    const [why, safe] = adds(view.why);
    expect(why).toBe(safe);
    const [steps, same] = adds(view.steps);
    expect(steps).toBe(same);
  });

  it("the chat says the pay is counted and not in checking yet", () => {
    expect(safeReply(safeOn("2026-11-20"), "2026-11-20").body).toContain(
      "That counts Blue Bottle's $1,650.00 due Nov 20, which isn't in checking yet.",
    );
  });
});

describe("safe to spend once the wait for pay runs out", () => {
  it("says the missed pay isn't counted, after the figure", () => {
    const view = heroView(hero("2026-11-22")).safe!;
    expect(view.cents).toBe(50_000 - 8_000);
    expect(view.why.at(-1)).toEqual({
      label: "Not counted: Blue Bottle pay due Nov 20, which hasn't come in",
      sign: "",
      cents: PAY,
    });
    expect(view.steps.at(-1)).toEqual(view.why.at(-1));
    expect(view.why.some((l) => l.sign === "+")).toBe(false);
    const [why, safe] = adds(view.why);
    expect(why).toBe(safe);
  });

  it("the chat says so too", () => {
    expect(safeReply(safeOn("2026-11-22"), "2026-11-22").body).toContain(
      "It doesn't count Blue Bottle's $1,650.00 due Nov 20, which hasn't come in.",
    );
  });

  it("says nothing of pay on a day it came in", () => {
    const view = heroView(hero("2026-11-19")).safe!;
    expect(view.why.some((l) => /pay due/.test(l.label))).toBe(false);
    expect(safeReply(safeOn("2026-11-19"), "2026-11-19").body).not.toMatch(
      /That counts|doesn.t count/,
    );
  });
});
