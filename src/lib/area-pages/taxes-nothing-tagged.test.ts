import { describe, expect, it } from "vitest";
import { taxesTree, type TaxesTreeInput } from "./taxes";

// Debug 2 (11-15, a student with 14 months of statements, 1280 light): Taxes → Records and forms
// → "Tagged for 2026" said "Donations, work and medical costs, and more, tagged from your
// accounts." and opened a list of seven tags, every one $0.00. With nothing tagged and nothing to
// check, the item says so in one line, and its detail draws no list (tags-section.test.tsx).

const input = (tags: TaxesTreeInput["tags"]): TaxesTreeInput => ({
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
  tags,
  records: { items: 0, needs: 0, gaps: 0, canGo: 0 },
  sideIncome: null,
  home: false,
  family: null,
  giving: null,
  profile: { complete: true, newIncome: 0, fields: [] },
});
const tagsItem = (tags: TaxesTreeInput["tags"]) => {
  const { tree, summaries } = taxesTree(input(tags));
  const item = tree.branches.flatMap((b) => b.items).find((i) => i.id === "records:tags")!;
  return { item, summary: summaries["records:tags"] };
};

describe("Tagged for the year, in the Taxes tree", () => {
  it("says nothing is tagged yet when nothing is", () => {
    const { item, summary } = tagsItem({ checks: 0, tagged: 0 });
    expect(summary).toBe("Nothing tagged for 2026 yet.");
    expect([item.status, item.figure]).toEqual(["good", undefined]);
  });

  it("says what tagging is once something is tagged or waits for a check", () => {
    expect(tagsItem({ checks: 0, tagged: 3 }).summary).toMatch(/^Donations, work and medical/);
    expect(tagsItem({ checks: 1, tagged: 0 }).item.figure).toBe("1 to check");
  });
});
