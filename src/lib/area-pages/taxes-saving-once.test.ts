import { describe, expect, it } from "vitest";
import { taxesTree, type TaxesTreeInput } from "./taxes";

// Debugger 11-15: a demo-bank student's Taxes tree had "Add to your 401(k), by Dec 31" under Due
// soon and "Save more for retirement, $1.9k/yr" under Pay less tax, both saying "Put about $1,975
// more a paycheck into your 401(k)", with different buttons. While the dated move is open it is
// said once, under Due soon, with its date and its saving.

const move = (handled: "added" | "no" | null, opensOn = "2026-10-01") => ({
  id: "2026:workplace_retirement",
  key: "workplace_retirement" as const,
  detail: "Put about $1,975 more a paycheck into your 401(k). It could save about $1,889.",
  deadline: "2026-12-31",
  opensOn,
  handled,
  amountCents: 188_900,
});

const input = (moves: TaxesTreeInput["moves"]): TaxesTreeInput => ({
  asOf: "2026-11-15",
  year: 2026,
  moves,
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
});

const retirementIds = (moves: TaxesTreeInput["moves"]) =>
  taxesTree(input(moves))
    .tree.branches.flatMap((b) => b.items.map((i) => i.id))
    .filter((id) => /retirement/.test(id));

describe("a tax saving that is also a dated move", () => {
  it("is said once, under Due soon, while the move is open", () => {
    expect(retirementIds([move(null)])).toEqual(["soon:2026:workplace_retirement"]);
  });

  it("is a saving again once the move is answered or not open yet", () => {
    expect(retirementIds([move("added")])).toContain("savings:retirement");
    expect(retirementIds([move(null, "2026-12-01")])).toContain("savings:retirement");
    expect(retirementIds([])).toEqual(["savings:retirement"]);
  });

  it("leaves the other savings where they are", () => {
    const ids = taxesTree(input([move(null)])).tree.branches.flatMap((b) =>
      b.items.map((i) => i.id),
    );
    expect(ids).toContain("savings:student_loan");
  });
});
