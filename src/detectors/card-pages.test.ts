import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { SUGGESTION_NODES } from "@/lib/area-pages/money";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { cheaperPlansOf } from "./cover-facts";
import { runDetectors } from "./index";

// Debug 2, 11-22 (sweep 16's dock, each card's links opened): a card with a figure opens a page
// that shows it and how it was worked out. "Check Lifeline for your phone bill, save $111/yr" and
// "Note T-Mobile's cheapest plan, save $81/yr" opened Coming up, which says neither.

const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";
const PHONE = "RENT_AND_UTILITIES_TELEPHONE";

function person(payee: string, cents: number, pfc: string, monthlyIncome: number): ProfileInput {
  const base = inputFor("renter");
  const account = base.accounts[0]!.id;
  return {
    ...base,
    householdSize: 1,
    told: { ...base.told, monthly_income: monthlyIncome },
    transactions: [
      ...base.transactions.filter((t) => t.pfc !== INTERNET && t.pfc !== PHONE),
      ...["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({
        date,
        amountCents: cents,
        description: payee,
        pfc,
        accountId: account,
      })),
    ],
  };
}
const card = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }).find((s) => s.topic === topic);

describe("a card with a figure opens the item that works it out", () => {
  it("Lifeline opens its own item on Spending, not Coming up", () => {
    const s = card(person("COMCAST XFINITY", 7_000, INTERNET, 130_000), "lifeline")!;
    expect(s.headline).toMatch(/\$111 a year$/);
    expect(s.action?.href).toBe("/money?focus=charges:lifeline");
    expect(SUGGESTION_NODES.lifeline?.branch).toBe("charges");
  });

  it("T-Mobile's cheapest plan opens its own item on Spending", () => {
    const s = card(person("T-MOBILE PCS SVC", 7_000, PHONE, 400_000), "phone_plan_cheaper");
    expect(s?.action?.href).toBe("/money?focus=charges:phone_plan_cheaper");
    expect(SUGGESTION_NODES.phone_plan_cheaper?.branch).toBe("charges");
  });

  it("the cheaper plans Subscriptions lists add up to the card's figure", () => {
    // Netflix $17.99 against $8.99 and ChatGPT $20.00 against Go's $8.00: $108 + $144 a year.
    const base = inputFor("renter");
    const account = base.accounts[0]!.id;
    const data: ProfileInput = {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => !/NETFLIX|CHATGPT/.test(t.description)),
        ...[
          ["2026-10-10", 1_799, "NETFLIX.COM"],
          ["2026-10-12", 2_000, "OPENAI *CHATGPT SUBSCR"],
        ].map(([date, cents, description]) => ({
          date: String(date),
          amountCents: Number(cents),
          description: String(description),
          pfc: "ENTERTAINMENT_TV_AND_MOVIES",
          accountId: account,
        })),
      ],
    };
    const plans = cheaperPlansOf(data);
    expect(plans.map((p) => [p.service, p.yearly])).toEqual([
      ["Netflix", 10_800],
      ["ChatGPT", 14_400],
    ]);
    expect(card(data, "cheaper_tier")?.worthCents).toBe(25_200);
    expect(card(data, "cheaper_tier")?.action?.href).toBe("/subscriptions");
  });
});
