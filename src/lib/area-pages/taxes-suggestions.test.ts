import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runDetectors } from "@/detectors";
import { SAVERS_CREDIT_DETECTORS } from "@/detectors/savers-credit";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { landing } from "./landing";
import { taxesTree, type TaxesTreeInput } from "./taxes";

// Debug 2 (11-15, a student with 14 months of statements, 1280 light): the dock's "Check the 2027
// Saver's Match, earn $537/yr", Yes ("See your tax plan") opened Taxes, and nothing on Taxes
// mentioned the Saver's Match or the Saver's Credit: Money's and Loans' trees list their area's
// open suggestions, the Taxes tree listed none. Now it does, and a tax card's Yes on the bare
// Taxes page (or a page the beta hides) opens its own item.

type Suggestion = NonNullable<TaxesTreeInput["suggestions"]>[number];

const input = (suggestions: Suggestion[]): TaxesTreeInput => ({
  asOf: "2026-11-15",
  year: 2026,
  moves: [],
  savings: [
    {
      key: "retirement",
      title: "Put about $1,975 more a paycheck into your 401(k)",
      estimateCents: 188_900,
    },
    { key: "student_loan", title: "Deduct your student loan interest", estimateCents: 25_500 },
  ],
  estimate: { refundCents: 370_000, withholdingKnown: true },
  setAside: { status: "covered", advice: true, holdCents: 0, percent: 0 },
  withholding: "big_refund",
  w4Sent: false,
  refunds: 0,
  investments: null,
  forms: { total: 0, received: 0, toCheck: 0 },
  tags: { checks: 0 },
  records: { items: 0, needs: 0, gaps: 0, canGo: 0 },
  sideIncome: null,
  home: false,
  family: null,
  giving: null,
  profile: { complete: true, newIncome: 0, fields: [] },
  suggestions,
});
// The Saver's cards as the detectors make them for a renter on $2,200 a month.
const cards = () => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    today: "2026-11-15",
    told: { ...base.told, monthly_income: 220_000, filing_status: "single" },
  };
  return runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS).map((s) => ({
    topic: s.topic,
    summary: s.short,
    worthCents: s.worthCents,
    worthKind: s.worthKind,
    headline: s.headline,
    urgency: s.urgency,
    status: "selected",
    // As stored (src/lib/suggestions.ts): the area page's link pointed at the suggestion's node.
    actionHref: landing(s.action.href, { key: s.id, topic: s.topic }),
  }));
};

const items = (suggestions: Suggestion[]) => {
  const { tree, summaries } = taxesTree(input(suggestions));
  return tree.branches.flatMap((b) => b.items).map((i) => ({ ...i, said: summaries[i.id] }));
};

describe("Jane's tax suggestions on the Taxes page", () => {
  it("lists the Saver's cards, and their Yes opens their own item", () => {
    const made = cards();
    expect(made.map((c) => c.topic).sort()).toEqual(["savers_credit", "savers_match"]);
    const listed = items(made);
    for (const c of made) {
      const focus = decodeURIComponent(/[?&]focus=([^&#]+)/.exec(c.actionHref)?.[1] ?? "");
      const item = listed.find((i) => i.id === focus);
      expect(item, c.topic).toBeDefined();
      expect(item!.label).toMatch(/Saver's/);
      expect(item!.said).toBe(c.summary);
    }
  });

  it("leaves out one whose button opens another item of the page", () => {
    const receipts: Suggestion = {
      topic: "charity_receipts",
      summary: "2 gifts have no receipt yet.",
      worthCents: 0,
      urgency: "soon",
      actionHref: "/taxes?focus=life:giving",
    };
    expect(items([receipts]).some((i) => i.id.includes("charity_receipts"))).toBe(false);
  });
});
