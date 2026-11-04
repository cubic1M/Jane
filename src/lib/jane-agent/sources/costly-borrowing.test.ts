import { describe, expect, it } from "vitest";
import { costlyBorrowingSource } from "./costly-borrowing";

type Gather = Parameters<typeof costlyBorrowingSource.gather>;

const bodyFor = (kind: string, aprBps: number) => {
  const snapshot = {
    costlyBorrowing: {
      any: true,
      totalYearlyCents: 14_000,
      kinds: [{ kind, aprBps, count: 4, costCents: 14_000, basis: "" }],
    },
  } as unknown as Gather[0];
  const context = { local: { date: "2026-11-04" } } as unknown as Gather[1];
  const found = costlyBorrowingSource.gather(snapshot, context);
  return (found as { body: string }[])[0].body;
};

describe("the costly borrowing message", () => {
  // Worked out on a made-up $24 overdraft: on the card with no basis it read "about 17743% a year".
  it("gives no yearly rate for overdraft fees, which rests on an assumed overdraft", () => {
    const body = bodyFor("overdraft", 1_774_300);
    expect(body).toContain("cost you $140.00");
    expect(body).not.toMatch(/% a year/);
  });

  it("gives it for a payday loan", () => {
    expect(bodyFor("payday", 39_100)).toContain("(about 391% a year)");
  });
});
