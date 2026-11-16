import { describe, expect, it } from "vitest";
import { costlyBorrowingSource } from "./costly-borrowing";

// Debug 2 (11-15, a student with 14 months of Wells Fargo statements and two $35 overdraft fees,
// 1280 light): the dock had "Stop paying overdraft and bank fees, save $139/yr" and, four cards
// on, "Costly short-term borrowing cost you $70.00 over the last year, most of it from overdraft
// fees. There are cheaper ways out, like a credit union payday alternative loan…": the same two
// fees twice, "most" of a total they were all of, and a loan for someone who never borrowed.

type Gather = Parameters<typeof costlyBorrowingSource.gather>;
type Kind = { kind: string; costCents: number; aprBps: number | null };

const gather = (kinds: Kind[]) => {
  const snapshot = {
    costlyBorrowing: {
      any: true,
      totalYearlyCents: kinds.reduce((s, k) => s + k.costCents, 0),
      kinds: kinds.map((k) => ({ ...k, count: 2, basis: "" })),
    },
  } as unknown as Gather[0];
  const context = { local: { date: "2026-11-15" } } as unknown as Gather[1];
  return costlyBorrowingSource.gather(snapshot, context) as { body: string }[];
};

describe("the costly borrowing message, for overdraft fees", () => {
  it("isn't raised when overdraft fees are all there is: the bank fees suggestion has them", () => {
    expect(gather([{ kind: "overdraft", costCents: 7_000, aprBps: 1_774_300 }])).toEqual([]);
  });

  it("says all of it when one kind is the whole cost", () => {
    const [m] = gather([{ kind: "payday", costCents: 9_000, aprBps: 39_100 }]);
    expect(m.body).toContain("cost you $90.00 over the last year, all of it from payday");
  });

  it("says most of it only when it is", () => {
    const [most] = gather([
      { kind: "payday", costCents: 9_000, aprBps: 39_100 },
      { kind: "overdraft", costCents: 3_500, aprBps: null },
    ]);
    expect(most.body).toContain("most of it from payday");
    const [biggest] = gather([
      { kind: "payday", costCents: 4_000, aprBps: 39_100 },
      { kind: "overdraft", costCents: 3_500, aprBps: null },
      { kind: "pay_app", costCents: 3_000, aprBps: null },
    ]);
    expect(biggest.body).toContain("the biggest part from payday");
  });
});
