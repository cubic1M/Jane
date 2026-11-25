import { describe, expect, it } from "vitest";
import { taxesTree, type TaxesTreeInput } from "./taxes";

// CodeRabbit sweep 1c, area-02 (#1, #8): a dated move that stands in for a saving keeps the saving's
// figure; a tax estimate with no known withholding shows the tax, not a refund-signed status.

const input = (over: Partial<TaxesTreeInput>): TaxesTreeInput => ({
  asOf: "2026-11-15",
  year: 2026,
  moves: [],
  savings: [],
  estimate: { refundCents: 0, withholdingKnown: false },
  setAside: { status: "covered", advice: true, holdCents: 0, percent: 0 },
  withholding: "unknown",
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
  ...over,
});
const items = (i: TaxesTreeInput) => taxesTree(i).tree.branches.flatMap((b) => b.items);

describe("a dated move that replaces a saving", () => {
  const move = {
    id: "2026:workplace_retirement",
    key: "workplace_retirement" as const,
    detail: "Put about $1,975 more a paycheck into your 401(k).",
    deadline: "2026-12-31",
    opensOn: "2026-10-01",
    handled: null,
    amountCents: 188_900,
  };
  const savings = [
    { key: "retirement" as const, title: "Put more into your 401(k)", estimateCents: 188_900 },
  ];

  it("carries the saving's figure beside the deadline", () => {
    const item = items(input({ moves: [move], savings })).find((i) => i.id.startsWith("soon:"));
    expect(item).toMatchObject({ figure: "by Dec 31", line: "$1.9k/yr" });
  });

  it("shows no saving figure when there is no matching saving", () => {
    const item = items(input({ moves: [move] })).find((i) => i.id.startsWith("soon:"));
    expect(item?.line).toBeUndefined();
  });
});

describe("the estimate when withholding is unknown", () => {
  it("shows the tax and takes no status from the refund sign", () => {
    const item = items(
      input({
        estimate: {
          refundCents: 0,
          withholdingKnown: false,
          totalTaxCents: 200_000,
          incomeCents: 9_000_000,
        },
      }),
    ).find((i) => i.id === "estimate:estimate");
    expect(item?.figure).toBe("$2k estimated tax");
    expect(item?.status).toBeUndefined();
  });

  it("keeps the refund display when withholding is known", () => {
    const item = items(
      input({
        estimate: {
          refundCents: 120_000,
          withholdingKnown: true,
          totalTaxCents: 200_000,
          incomeCents: 9_000_000,
        },
      }),
    ).find((i) => i.id === "estimate:estimate");
    expect(item).toMatchObject({ figure: "$1.2k back", status: "good" });
  });
});
