import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { summarize } from "@/planning/costly-borrowing";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// Spec step 247: the costly borrowing detector (high_cost_loans) reads the same planner as the
// /loans/costly page, so the figure it brings unasked is the one the page shows.

const costly = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }).find((s) => s.topic === "high_cost_loans");

describe("costly short-term borrowing, brought unasked", () => {
  it("reaches Chris, whose payday loan repayments show every month, and no one else", () => {
    for (const p of PEOPLE) {
      const s = costly(inputFor(p.id));
      if (p.id === "debt") {
        expect(s, p.id).toBeDefined();
      } else {
        expect(s, p.id).toBeUndefined();
      }
    }
  });

  it("says the planner's dollars, with a confidence and the page to act on", () => {
    const data = inputFor("debt");
    const s = costly(data)!;
    const cards = new Set(data.accounts.filter((a) => a.type === "credit").map((a) => a.id));
    const plan = summarize(
      data.transactions.map((t, i) => ({
        id: String(i),
        date: t.date,
        amountCents: t.amountCents,
        description: t.description,
        pfcDetailed: t.pfc,
        card: cards.has(t.accountId),
      })),
      data.today,
    );
    const payday = plan.kinds.find((k) => k.kind === "payday")!;
    expect(s.worthCents).toBe(payday.costCents);
    expect(s.headline).toMatch(/^Replace your payday loan, save \$[\d,]+ a year$/);
    expect(s.why).toContain("taken again and again");
    expect(s.confidence.percent).toBeGreaterThanOrEqual(80);
    expect(s.confidence.reason).toMatch(/payday loans in \d+ months of data/);
    expect(s.action.href).toBe("/loans/costly");
  });

  it("names a pay advance app when that's all there is", () => {
    const base = inputFor("renter");
    const checking = base.accounts.find((a) => a.type === "depository")!.id;
    const data: ProfileInput = {
      ...base,
      transactions: [
        ...base.transactions,
        ...["2026-08-01", "2026-09-01", "2026-10-01"].flatMap((d) => [
          {
            date: d,
            amountCents: -10_000,
            description: "EARNIN ADVANCE",
            pfc: "LOAN_DISBURSEMENTS_EWA",
            accountId: checking,
          },
          {
            date: d.replace(/-01$/, "-08"),
            amountCents: 10_000,
            description: "EARNIN REPAYMENT",
            pfc: "LOAN_PAYMENTS_EWA",
            accountId: checking,
          },
          {
            date: d.replace(/-01$/, "-08"),
            amountCents: 500,
            description: "EARNIN TIP",
            pfc: "BANK_FEES_OTHER_BANK_FEES",
            accountId: checking,
          },
        ]),
      ],
    };
    const s = costly(data)!;
    expect(s.title).toBe("Replace the pay advance app with something cheaper");
    expect(s.worthCents).toBe(1_500);
  });
});

// Loans QA (from the chat QA): the payoff plan rests on the debts, not the fees that made Chris's
// money count as trouble.
describe("the payoff plan's evidence", () => {
  it("bases Chris's payoff plan on his cards and their interest, not overdraft fees", () => {
    const s = runDetectors({
      profile: buildProfile(inputFor("debt")),
      data: inputFor("debt"),
    }).find((x) => x.topic === "debt_plan")!;
    expect(s.confidence.reason).toMatch(/cards? linked|interest charges/);
    expect(s.confidence.reason).not.toMatch(/overdraft|late fees|insufficient/);
  });
});
