import { describe, expect, it } from "vitest";
import {
  DIFFERENT_ACCOUNT_MAX_RATIO,
  SAME_ACCOUNT_MATCH_RATIO,
  SAME_ACCOUNT_MIN_LINES,
} from "@/config/detection";
import { addDays } from "@/lib/dates";
import { balanceOnOrBefore, compareAccounts, matchLines, type Line } from "./same-account";

// An upload beside a linked account of the same bank and kind: one account or two, by what each shows.

const month = (n: number) => String(n).padStart(2, "0");
// Twelve charges, one a week from 1 September.
const week = (i: number): string => {
  const d = new Date(Date.UTC(2026, 8, 1 + i * 7));
  return `2026-${month(d.getUTCMonth() + 1)}-${month(d.getUTCDate())}`;
};
const lines = (amounts: number[], shift = 0): Line[] =>
  amounts.map((amountCents, i) => ({
    date: week(i + shift),
    amountCents,
  }));
const AMOUNTS = [1250, 4599, 899, 12000, 3300, 760, 2500, 18000, 450, 6100, 999, 1500];
const none = () => null;

describe("comparing an upload with a link", () => {
  it("is the same account when most of the lines both cover are on both sides", () => {
    const link = lines(AMOUNTS);
    // The statement dates every charge a day after the bank does, which the day slack allows.
    const upload = link.map((l) => ({ ...l, date: addDays(l.date, 1) }));
    const got = compareAccounts({ upload, link, closing: null, linkBalanceOn: none });
    // A line at either end sits outside the days both cover, but its partner is within the slack.
    expect(got).toMatchObject({ verdict: "same", by: "lines" });
    expect(got.matched).toBe(got.compared);
  });

  it("is a different account when almost none of them are", () => {
    const other = [333, 777, 1234, 4321, 555, 8080, 909, 1111, 2222, 3333, 4444, 5555];
    expect(
      compareAccounts({
        upload: lines(other),
        link: lines(AMOUNTS),
        closing: null,
        linkBalanceOn: none,
      }),
    ).toMatchObject({ verdict: "different", by: "lines", matched: 0 });
  });

  it("says nothing in between, and with too few lines or no days in common", () => {
    const half = [...AMOUNTS.slice(0, 6), 1, 2, 3, 4, 5, 6];
    expect(
      compareAccounts({
        upload: lines(half),
        link: lines(AMOUNTS),
        closing: null,
        linkBalanceOn: none,
      }).verdict,
    ).toBe("unknown");
    expect(
      compareAccounts({
        upload: lines(AMOUNTS.slice(0, SAME_ACCOUNT_MIN_LINES - 1)),
        link: lines(AMOUNTS),
        closing: null,
        linkBalanceOn: none,
      }).verdict,
    ).toBe("unknown");
    expect(
      compareAccounts({
        upload: lines(AMOUNTS.slice(0, 6)),
        link: lines(AMOUNTS.slice(0, 6), 30),
        closing: null,
        linkBalanceOn: none,
      }),
    ).toMatchObject({ verdict: "unknown", by: "none", compared: 0 });
  });

  it("settles what the lines can't by a closing balance equal to the link's that day", () => {
    const input = {
      upload: [] as Line[],
      link: [] as Line[],
      closing: { date: "2026-10-31", cents: 485_000 },
    };
    expect(compareAccounts({ ...input, linkBalanceOn: () => 485_050 })).toMatchObject({
      verdict: "same",
      by: "balance",
    });
    expect(compareAccounts({ ...input, linkBalanceOn: () => 390_000 }).verdict).toBe("unknown");
    expect(compareAccounts({ ...input, linkBalanceOn: none }).verdict).toBe("unknown");
  });

  it("matches one to one, so one line on the link can't vouch for two on the upload", () => {
    // Three alike on 15 September against one; the same line at both ends keeps them off the edge.
    const ends = (amountCents: number): Line[] => [
      { date: "2026-09-10", amountCents },
      { date: "2026-09-20", amountCents },
    ];
    const upload: Line[] = [
      ...ends(1),
      ...[1, 2, 3].map(() => ({ date: "2026-09-15", amountCents: 500 })),
    ];
    const link: Line[] = [...ends(1), { date: "2026-09-15", amountCents: 500 }];
    expect(matchLines(upload, link)).toMatchObject({ matched: 1, compared: 1 });
  });

  it("reads the link's balance on a day only if its history reaches it", () => {
    const readings = [
      { date: "2026-10-29", balanceCents: 100 },
      { date: "2026-10-20", balanceCents: 5 },
    ];
    expect(balanceOnOrBefore(readings, "2026-10-31", 3)).toBe(100);
    expect(balanceOnOrBefore(readings, "2026-11-30", 3)).toBeNull();
    expect(balanceOnOrBefore(readings, "2026-10-10", 3)).toBeNull();
  });

  it("keeps the thresholds in the config, with a gap between same and different", () => {
    expect(DIFFERENT_ACCOUNT_MAX_RATIO).toBeLessThan(SAME_ACCOUNT_MATCH_RATIO);
  });

  it("finds the most matches, not the first: a nearest-day pick can take a line a later one needs", () => {
    const d = (n: number) => `2026-09-0${n}`;
    const upload: Line[] = [
      { date: d(1), amountCents: 101 },
      { date: d(3), amountCents: 500 },
      { date: d(5), amountCents: 500 },
      { date: d(6), amountCents: 102 },
      { date: d(7), amountCents: 103 },
    ];
    const link: Line[] = [
      { date: d(1), amountCents: 500 },
      { date: d(3), amountCents: 500 },
      { date: d(4), amountCents: 201 },
      { date: d(6), amountCents: 202 },
      { date: d(7), amountCents: 203 },
    ];
    expect(matchLines(upload, link)).toMatchObject({ matched: 2, compared: 3 });
    // Two of five is not "almost none": nothing is said, and the upload is left out.
    expect(compareAccounts({ upload, link, closing: null, linkBalanceOn: none }).verdict).toBe(
      "unknown",
    );
  });

  it("is unknown, never different, when the two share only a few days", () => {
    // The statement ends on the 3rd of the link's history: six lines each, none alike, in three days.
    const upload: Line[] = [11, 12, 13, 14, 15, 16].map((n) => ({
      date: `2026-09-0${(n % 3) + 1}`,
      amountCents: n,
    }));
    const link: Line[] = [21, 22, 23, 24, 25, 26].map((n) => ({
      date: `2026-09-0${(n % 3) + 1}`,
      amountCents: n,
    }));
    expect(compareAccounts({ upload, link, closing: null, linkBalanceOn: none })).toMatchObject({
      verdict: "unknown",
    });
  });

  it("matches a transfer the bank reports as two legs to the one line the statement has", () => {
    const upload = lines(AMOUNTS);
    const link: Line[] = lines(AMOUNTS).flatMap((l, i) =>
      i % 3 === 0
        ? [
            { date: l.date, amountCents: l.amountCents - 100 },
            { date: l.date, amountCents: 100 },
          ]
        : [l],
    );
    expect(compareAccounts({ upload, link, closing: null, linkBalanceOn: none }).verdict).toBe(
      "same",
    );
  });

  it("matches a charge near the edge to its partner just outside the shared days", () => {
    // Every link line a day earlier than the statement's, across the edges of the shared days.
    const mine: Line[] = [
      ...[101, 103, 107, 109].map((a) => ({ date: "2026-09-02", amountCents: a })),
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ date: `2026-09-${10 + n}`, amountCents: 10_000 + n })),
      ...[211, 223, 227, 229].map((a) => ({ date: "2026-10-01", amountCents: a })),
    ];
    const theirs = mine.map((l) => ({ ...l, date: addDays(l.date, -1) }));
    const got = compareAccounts({ upload: mine, link: theirs, closing: null, linkBalanceOn: none });
    // The lines inside the shared days all have their partners: never "different".
    expect(got.verdict).toBe("same");
    expect(got.matched).toBe(got.compared);
  });

  it("never calls a few lines at the edge of the shared days a different account", () => {
    const mine: Line[] = [
      ...[101, 103, 107, 109].map((a) => ({ date: "2026-09-02", amountCents: a })),
      { date: "2026-09-16", amountCents: 10_000 },
      ...[211, 223, 227, 229].map((a) => ({ date: "2026-10-01", amountCents: a })),
    ];
    const theirs = mine.map((l) => ({ ...l, date: addDays(l.date, -1) }));
    expect(
      compareAccounts({ upload: mine, link: theirs, closing: null, linkBalanceOn: none }).verdict,
    ).not.toBe("different");
  });

  it("does not let the order of two-leg lines decide, and never calls them different", () => {
    const on = (date: string, amounts: number[]): Line[] =>
      amounts.map((amountCents) => ({ date, amountCents }));
    // The same charge on 1 and 20 September on both sides keeps the days between off the edges.
    const anchors = [...on("2026-09-01", [999]), ...on("2026-09-20", [998])];
    const upload = [
      ...anchors,
      ...on("2026-09-05", [10, 11]),
      ...on("2026-09-15", [100, 101, 103]),
    ];
    const orders = [
      [4, 6, 5, 5, 7],
      [5, 5, 4, 7, 6],
      [7, 4, 5, 6, 5],
    ];
    for (const legs of orders) {
      const link = [...anchors, ...on("2026-09-05", legs), ...on("2026-09-15", [1000, 1100, 1200])];
      const got = compareAccounts({ upload, link, closing: null, linkBalanceOn: none });
      expect(got.verdict).toBe("unknown");
      expect(got.matched).toBe(2);
    }
  });

  it("finishes in well under a second with two thousand lines a side, and never hangs", () => {
    // Two different checking accounts at one bank over two years: nothing alike, so every search runs.
    const make = (amount: number, count: number): Line[] =>
      Array.from({ length: count }, (_, i) => ({
        date: addDays("2025-01-01", i % 700),
        amountCents: amount + (i % 7),
      }));
    const started = Date.now();
    const got = compareAccounts({
      upload: make(1000, 2000),
      link: make(3000, 2000),
      closing: null,
      linkBalanceOn: none,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(["different", "unknown"]).toContain(got.verdict);
  });

  it("says unknown, not different, when the work runs past its budget", () => {
    // Fifteen hundred alike lines a side with every one a candidate for every other: the search
    // spends its steps, and what is left is unknown, never a verdict from half a search.
    const alike = (): Line[] =>
      Array.from({ length: 1500 }, (_, i) => ({
        date: addDays("2025-01-01", 3 + (i % 3)),
        amountCents: 500,
      }));
    const edges: Line[] = [
      { date: "2025-01-01", amountCents: 1 },
      { date: "2025-01-12", amountCents: 2 },
    ];
    const upload = [...alike(), ...edges].slice(0, 1500);
    const link = [...alike(), ...edges].slice(0, 1500);
    const found = matchLines(upload, link);
    expect(found.exhausted).toBe(true);
    expect(compareAccounts({ upload, link, closing: null, linkBalanceOn: none }).verdict).toBe(
      "unknown",
    );
  });

  it("says unknown, not different, past the limit of lines", () => {
    const over = (amount: number): Line[] =>
      Array.from({ length: 1501 }, (_, i) => ({
        date: addDays("2025-01-01", i % 100),
        amountCents: amount + i,
      }));
    const got = compareAccounts({
      upload: over(1),
      link: over(100_000),
      closing: null,
      linkBalanceOn: none,
    });
    expect(got.verdict).toBe("unknown");
  });

  it("counts a pair from the side whose line is inside the shared days", () => {
    // Five charges on 1 September on the upload, a day later on the link; the shared days start on
    // 1 September for the upload and the link's history starts on the 2nd; five others inside.
    const upload: Line[] = [
      ...[11, 12, 13, 14, 15].map((a) => ({ date: "2026-09-02", amountCents: a })),
      ...[21, 22, 23, 24, 25].map((a) => ({ date: "2026-09-10", amountCents: a })),
      { date: "2026-09-20", amountCents: 999 },
    ];
    const link: Line[] = [
      { date: "2026-09-01", amountCents: 998 },
      ...[11, 12, 13, 14, 15].map((a) => ({ date: "2026-09-03", amountCents: a })),
      ...[31, 32, 33, 34, 35].map((a) => ({ date: "2026-09-10", amountCents: a })),
      { date: "2026-09-20", amountCents: 999 },
    ];
    const got = compareAccounts({ upload, link, closing: null, linkBalanceOn: none });
    expect(got.verdict).not.toBe("different");
  });

  it("does not reuse two legs to explain five lines as the same account", () => {
    const anchors: Line[] = [
      { date: "2026-09-01", amountCents: 999 },
      { date: "2026-09-20", amountCents: 998 },
    ];
    const upload: Line[] = [
      ...anchors,
      ...[1, 2, 3, 4, 5].map(() => ({ date: "2026-09-10", amountCents: 1000 })),
    ];
    const link: Line[] = [
      ...anchors,
      ...[400, 600, 5000, 5000, 5000].map((a) => ({ date: "2026-09-10", amountCents: a })),
    ];
    expect(compareAccounts({ upload, link, closing: null, linkBalanceOn: none }).verdict).not.toBe(
      "same",
    );
  });

  it("lets a closing balance settle lines that look like the same account with signs turned", () => {
    const link = lines(AMOUNTS);
    const upload = lines(AMOUNTS).map((l) => ({ ...l, amountCents: -l.amountCents }));
    expect(
      compareAccounts({
        upload,
        link,
        closing: { date: "2026-10-31", cents: 120_000 },
        linkBalanceOn: () => 120_000,
      }),
    ).toMatchObject({ verdict: "same", by: "balance" });
  });
  it("never calls two accounts different when one is the other with its signs turned", () => {
    const link = lines(AMOUNTS);
    const upload = lines(AMOUNTS).map((l) => ({ ...l, amountCents: -l.amountCents }));
    expect(compareAccounts({ upload, link, closing: null, linkBalanceOn: none }).verdict).toBe(
      "unknown",
    );
  });

  it("does not call lines different when the days differ by a long weekend", () => {
    const link = lines(AMOUNTS);
    const upload = link.map((l) => ({ ...l, date: addDays(l.date, 4) }));
    expect(compareAccounts({ upload, link, closing: null, linkBalanceOn: none }).verdict).not.toBe(
      "different",
    );
  });
});
