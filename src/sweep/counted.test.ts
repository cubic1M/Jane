import { describe, expect, it } from "vitest";
import { withoutCopies } from "@/lib/account-copies";
import { accountsLeftOut, copiesToLeaveOut, type CountAcct } from "@/planning/books";
import { countingProblems } from "./counted";

// Class 12: each way an account got into net worth twice, counted as main did (every account but the
// certain copies the same-last-four rule found), then as the founder's rule does (src/planning/books.ts
// accountsLeftOut). Each fails on main's count and passes on the new one.

let n = 0;
const acct = (over: Partial<CountAcct> & Pick<CountAcct, "name">): CountAcct => {
  n += 1;
  return {
    id: `acc${String(n).padStart(3, "0")}`,
    itemId: null,
    source: "csv",
    mask: null,
    type: "depository",
    subtype: "checking",
    ...over,
  };
};
const link = (over: Partial<CountAcct> & Pick<CountAcct, "name">) =>
  acct({ itemId: "item_chase", source: "plaid", ...over });
const BANKS: Record<string, string> = { item_chase: "Chase", item_chase_again: "Chase" };
const bankOf = (a: CountAcct) => (a.itemId ? (BANKS[a.itemId] ?? null) : null);

const mainCounts = (accounts: CountAcct[]) =>
  withoutCopies(accounts, copiesToLeaveOut(accounts), (a) => a.id);
const nowCounts = (accounts: CountAcct[], separate: ReadonlySet<string> = new Set()) => {
  const left = accountsLeftOut(accounts, { bankOf, separate });
  return withoutCopies(accounts, new Set(left.keys()), (a) => a.id);
};

const SHAPES: [string, () => CountAcct[]][] = [
  [
    "an upload with no last four, then the account linked",
    () => [acct({ name: "Chase checking" }), link({ name: "TOTAL CHECKING", mask: "1234" })],
  ],
  [
    "an upload with the last four, the link naming the subtype another way",
    () => [
      acct({ name: "Chase checking", mask: "1234" }),
      link({ name: "Checking", mask: "1234", subtype: "cash management" }),
    ],
  ],
  [
    "the same statement uploaded twice as two accounts",
    () => [
      acct({ name: "Chase checking", mask: "1234" }),
      acct({ name: "Chase checking (2)", mask: "1234" }),
    ],
  ],
  [
    "two uploads of one account with no last four",
    () => [acct({ name: "Chase checking" }), acct({ name: "Chase checking statement" })],
  ],
  [
    "an account linked twice, named two ways",
    () => [
      link({ name: "Checking", mask: "1234" }),
      link({
        name: "Checking",
        mask: "1234",
        itemId: "item_chase_again",
        subtype: "cash management",
      }),
    ],
  ],
];

describe("what net worth counts holds each account once", () => {
  for (const [name, make] of SHAPES) {
    it(`${name}: counted twice on main, once now`, () => {
      const accounts = make();
      expect(countingProblems(mainCounts(accounts), bankOf)).not.toEqual([]);
      expect(countingProblems(nowCounts(accounts), bankOf)).toEqual([]);
    });
  }

  it("holds for two different accounts at one bank, and a statement said to be separate", () => {
    const accounts = [
      link({ name: "TOTAL CHECKING", mask: "1234" }),
      acct({ name: "Chase savings", subtype: "savings" }),
      acct({ name: "Chase checking 5678", mask: "5678" }),
    ];
    expect(nowCounts(accounts)).toHaveLength(3);
    expect(countingProblems(nowCounts(accounts), bankOf)).toEqual([]);
    const mine = acct({ name: "Chase checking" });
    const pair = [link({ name: "TOTAL CHECKING", mask: "1234" }), mine];
    expect(nowCounts(pair, new Set([mine.id]))).toHaveLength(2);
    expect(
      countingProblems(nowCounts(pair, new Set([mine.id])), bankOf, new Set([mine.id])),
    ).toEqual([]);
  });
});
