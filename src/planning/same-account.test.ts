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
    // A line at either end falls outside the days both cover: eleven are compared, ten match.
    expect(got).toMatchObject({ verdict: "same", by: "lines", matched: 10, compared: 11 });
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
    ).toMatchObject({ verdict: "different", by: "lines", matched: 0, compared: 12 });
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
    const upload: Line[] = [1, 2, 3].map(() => ({ date: "2026-09-01", amountCents: 500 }));
    const link: Line[] = [{ date: "2026-09-01", amountCents: 500 }];
    expect(matchLines(upload, link)).toEqual({ matched: 1, compared: 1 });
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
});
