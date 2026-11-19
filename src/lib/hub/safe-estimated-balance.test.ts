import { describe, expect, it } from "vitest";
import { CARD, CHECKING, GEICO, input, monthsAgo, tx } from "@/detection/__fixtures__/build";
import { safeToSpend } from "@/planning/safe-to-spend";
import { heroView, type HeroInput } from "./view";

// Debugger 11-19 (r346 and r359, upload S3 on a phone): a Chase statement ending Nov 12 at $2,310.55,
// read on Nov 19. Home's safe to spend said "In checking now $3,879": the balance walked forward with
// the Nov 15 paycheck the statement doesn't show, while the report, the chat and the cushion card
// all said $2,310.55. The walk stays (the forecast does the same), but the line says it's an
// estimate and what it added since the statement.

// AS_OF is Oct 15. A statement from Oct 10; Geico comes out of checking on the 12th.
const pay = [3, 2, 1, 0].map((m) =>
  tx({
    date: monthsAgo(m, 1),
    amountCents: -300_000,
    description: "ACME PAYROLL",
    merchantName: "Acme",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_SALARY",
  }),
);
const geico = [3, 2, 1].map((m) => tx({ ...GEICO, date: monthsAgo(m, 12), amountCents: 9_800 }));
const safeFor = (balanceAsOf?: string) =>
  safeToSpend(
    input({
      accounts: [{ ...CHECKING, currentBalanceCents: 150_000, balanceAsOf }, CARD],
      transactions: [...pay, ...geico],
    }),
    { budgetsLeftCents: 0, goalsCents: 0 },
  );
const hero = (safe: ReturnType<typeof safeFor>): HeroInput => ({
  asOf: "2026-10-15",
  safe,
  netWorth: null,
  foundCents: 0,
  savedCents: 0,
});

describe("safe to spend from a statement walked forward", () => {
  it("says the balance is an estimate, and what it added since the statement", () => {
    const view = heroView(hero(safeFor("2026-10-10"))).safe!;
    const note = "−$98 of pay and bills expected since your Oct 10 statement";
    expect(view.why[0]).toEqual({
      label: "In checking now, estimated",
      sign: "",
      cents: 150_000 - 9_800,
      note,
    });
    expect(view.steps[0]).toEqual({
      label: "In checking today, estimated",
      sign: "",
      cents: 150_000 - 9_800,
      note,
    });
  });

  it("keeps the plain line for a balance as it stands", () => {
    const view = heroView(hero(safeFor())).safe!;
    expect(view.why[0]).toEqual({ label: "In checking now", sign: "", cents: 150_000 });
    expect(view.steps[0]).toEqual({ label: "In checking today", sign: "", cents: 150_000 });
  });
});
