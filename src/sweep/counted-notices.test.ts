import { describe, expect, it } from "vitest";
import { maybeSamePair, maybeSameWords, netWorthLine } from "@/insights/net-worth";
import { linkedAccountNote } from "@/lib/import/wrong-account";
import { historyProblems, noticeProblems } from "./counted";

// The counted invariant's other half (debug 2, 11-26): what is said about the accounts left out, and
// the months net worth lists, agree with what is counted.

const older = (counted: boolean) => ({
  reason: "older_upload" as const,
  left: { name: "Chase checking old" },
  with: { name: "Chase checking", counted },
});

describe("notices against the counted set", () => {
  it("fails a notice saying the other one is counted when it isn't", () => {
    const wrong = { leftId: "old", withId: "new", words: maybeSamePair(older(true)) };
    expect(noticeProblems(new Set(["link"]), [wrong])).toHaveLength(1);
    expect(noticeProblems(new Set(["new"]), [wrong])).toEqual([]);
  });

  it("passes the words made for each case, and fails them the other way round", () => {
    const said = (counted: boolean) => ({
      leftId: "old",
      withId: "new",
      words: maybeSamePair(older(counted)),
    });
    expect(noticeProblems(new Set(["link"]), [said(false)])).toEqual([]);
    expect(noticeProblems(new Set(["new"]), [said(false)])).toHaveLength(1);
  });

  it("fails an account said to be left out that is counted, or counted that isn't", () => {
    const note = { leftId: "old", withId: "new", words: maybeSamePair(older(true)) };
    expect(noticeProblems(new Set(["old", "new"]), [note])).toHaveLength(1);
    expect(noticeProblems(new Set(), [], ["mine"])).toHaveLength(1);
    expect(noticeProblems(new Set(["mine"]), [], ["mine"])).toEqual([]);
  });

  it("says several without calling one a copy of an account that isn't counted", () => {
    expect(maybeSameWords([older(false), older(true), older(true)])).toBe(
      "3 of your accounts look like copies or earlier uploads, so they are left out of net worth.",
    );
    expect(maybeSameWords([older(true), older(true)])).toBe(
      "2 of your accounts look like copies of ones already counted, so they are left out of net worth.",
    );
  });
});

describe("months against the counted balances", () => {
  const link = { id: "l", type: "depository", currentBalanceCents: 200 };
  const car = { id: "car", valueCents: 900, valuedOn: "2026-03-01" };
  const snapshots = [
    { accountId: "l", date: "2026-10-05", balanceCents: 150 },
    // An account that isn't counted, with history months earlier.
    { accountId: "u", date: "2026-04-01", balanceCents: 777 },
  ];

  it("starts at the first balance of a counted account, things owned too", () => {
    const months = netWorthLine([link], snapshots, [car], "2026-11-24", 8, 1_100);
    expect(months.filter((m) => m.netCents !== null)).toEqual([
      { month: "2026-10", netCents: 1_050 },
      { month: "2026-11", netCents: 1_100 },
    ]);
    expect(historyProblems(months, ["2026-10-05"])).toEqual([]);
  });

  it("fails a month no counted account has a balance by", () => {
    const months = [
      { month: "2026-09", netCents: 200 },
      { month: "2026-10", netCents: 200 },
      { month: "2026-11", netCents: 200 },
    ];
    expect(historyProblems(months, ["2026-10-05"])).toHaveLength(1);
    expect(historyProblems(months, [])).toHaveLength(2);
  });
});

describe("the warning on a file from a linked bank", () => {
  const linked = [
    { name: "TOTAL CHECKING", institution: "Chase", mask: "0000", kind: "checking" },
    { name: "CHASE SAVINGS", institution: "Chase", mask: "1111", kind: "savings" },
  ];

  it("names no account when more than one fits", () => {
    const note = linkedAccountNote(linked, [{ file: "savings.csv", bank: "Chase", mask: null }]);
    expect(note?.text).toBe(
      `Jane can't yet tell whether savings.csv is one of your linked Chase accounts. Until it can, savings.csv is left out of net worth; "This is a different account" on this page counts it.`,
    );
    // A file of a kind: only the linked account of that kind fits (a savings file is no checking's).
    const one = linkedAccountNote(linked, [
      { file: "savings.csv", bank: "Chase", kind: "savings", mask: null },
    ]);
    expect(one?.text).toContain("is your linked CHASE SAVINGS ····1111");
  });
});
