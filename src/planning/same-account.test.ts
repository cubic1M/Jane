import { describe, expect, it } from "vitest";
import {
  DIFFERENT_ACCOUNT_MAX_RATIO,
  SAME_ACCOUNT_MATCH_RATIO,
  SAME_ACCOUNT_MAX_LINES,
  SAME_ACCOUNT_MIN_LINES,
} from "@/config/detection";
import { addDays } from "@/lib/dates";
import { balanceOnOrBefore, compareAccounts, matchLines, type Line } from "./same-account";

// An upload beside a linked account of the same bank and kind: one account or two, by what each
// shows. "Different" is the verdict that brings a double count back, so it takes clean evidence;
// anything else the lines can't say is "unknown", which leaves the upload out and says so.

const AMOUNTS = [1250, 4599, 899, 12000, 3300, 760, 2500, 18000, 450, 6100, 999, 1500];
const OTHER = [333, 777, 1234, 4321, 555, 8080, 909, 1111, 2222, 3333, 4444, 5555];
// One a week from 1 September.
const lines = (amounts: number[], shift = 0): Line[] =>
  amounts.map((amountCents, i) => ({ date: addDays("2026-09-01", (i + shift) * 7), amountCents }));
const none = () => null;
const compare = (upload: Line[], link: Line[], over: object = {}) =>
  compareAccounts({ upload, link, closing: null, linkBalanceOn: none, ...over });

describe("comparing an upload with a link", () => {
  it("is the same account when most of the lines both cover are on both sides", () => {
    const link = lines(AMOUNTS);
    // The statement dates every charge a day after the bank does, which the day slack allows.
    const upload = link.map((l) => ({ ...l, date: addDays(l.date, 1) }));
    expect(compare(upload, link)).toMatchObject({ verdict: "same", by: "lines" });
  });

  it("is the same account when the upload is only part of what the link shows", () => {
    expect(compare(lines(AMOUNTS.slice(2, 10), 2), lines(AMOUNTS)).verdict).toBe("same");
  });

  it("is a different account when almost none are alike, with enough days and lines", () => {
    expect(compare(lines(OTHER), lines(AMOUNTS))).toMatchObject({ verdict: "different" });
  });

  it("is a closing balance equal to the link's that day that settles what the lines can't", () => {
    const closing = { date: "2026-10-31", cents: 485_000 };
    expect(compare([], [], { closing, linkBalanceOn: () => 485_050 })).toMatchObject({
      verdict: "same",
      by: "balance",
    });
    expect(compare([], [], { closing, linkBalanceOn: () => 390_000 }).verdict).toBe("unknown");
    expect(compare([], [], { closing, linkBalanceOn: none }).verdict).toBe("unknown");
    // Lines that look different, with the balance the same: the same account.
    expect(
      compare(lines(OTHER), lines(AMOUNTS), { closing, linkBalanceOn: () => 485_000 }).verdict,
    ).toBe("same");
  });

  it("is unknown with too few lines, no days in common, or too short a shared stretch", () => {
    expect(compare(lines(OTHER.slice(0, SAME_ACCOUNT_MIN_LINES - 1)), lines(AMOUNTS)).verdict).toBe(
      "unknown",
    );
    expect(compare(lines(AMOUNTS.slice(0, 6)), lines(AMOUNTS.slice(0, 6), 30)).verdict).toBe(
      "unknown",
    );
    // Six lines each, none alike, in three days: the upload ends just after the link's history begins.
    const few = (base: number): Line[] =>
      [0, 1, 2, 3, 4, 5].map((n) => ({
        date: `2026-09-0${(n % 3) + 1}`,
        amountCents: base + n,
      }));
    expect(compare(few(10), few(20)).verdict).toBe("unknown");
  });

  it("is unknown, never different, when lines are plentiful on one side only", () => {
    expect(compare(lines(OTHER.slice(0, 3)), lines(AMOUNTS)).verdict).toBe("unknown");
  });

  it("is unknown, never different, when either side was cut short", () => {
    expect(compare(lines(OTHER), lines(AMOUNTS), { truncated: true }).verdict).toBe("unknown");
  });

  it("is unknown, never different, when the days differ by a long weekend", () => {
    const link = lines(AMOUNTS);
    const upload = link.map((l) => ({ ...l, date: addDays(l.date, 4) }));
    expect(compare(upload, link).verdict).not.toBe("different");
  });

  it("is unknown, never different, when one is the other with its signs turned", () => {
    const upload = lines(AMOUNTS).map((l) => ({ ...l, amountCents: -l.amountCents }));
    expect(compare(upload, lines(AMOUNTS)).verdict).toBe("unknown");
    // A closing balance equal to the link's still settles it as the same.
    expect(
      compare(upload, lines(AMOUNTS), {
        closing: { date: "2026-10-31", cents: 120_000 },
        linkBalanceOn: () => 120_000,
      }).verdict,
    ).toBe("same");
  });

  it("counts a match whose partner sits just across the first shared day", () => {
    // Five charges on 1 September on the upload against five on the 2nd on the link, five unrelated
    // ones inside on each side, and 20 September shared.
    const upload: Line[] = [
      ...[11, 12, 13, 14, 15].map((a) => ({ date: "2026-09-01", amountCents: a })),
      ...[21, 22, 23, 24, 25].map((a) => ({ date: "2026-09-10", amountCents: a })),
      { date: "2026-09-20", amountCents: 999 },
    ];
    const link: Line[] = [
      ...[11, 12, 13, 14, 15].map((a) => ({ date: "2026-09-02", amountCents: a })),
      ...[31, 32, 33, 34, 35].map((a) => ({ date: "2026-09-10", amountCents: a })),
      { date: "2026-09-20", amountCents: 999 },
    ];
    expect(compare(upload, link).verdict).not.toBe("different");
  });

  it("matches one to one: one line on the link can't vouch for two on the upload", () => {
    const ends = (amountCents: number): Line[] => [
      { date: "2026-09-10", amountCents },
      { date: "2026-09-20", amountCents },
    ];
    const upload: Line[] = [
      ...ends(1),
      ...[1, 2, 3].map(() => ({ date: "2026-09-15", amountCents: 500 })),
    ];
    const link: Line[] = [...ends(1), { date: "2026-09-15", amountCents: 500 }];
    const got = matchLines(upload, link);
    expect(got.upload.matched).toBe(1);
    expect(got.link.matched).toBe(1);
  });

  it("matches the most it can, not the first it finds", () => {
    // Either end of 1 to 20 September, then one line on the 5th and one on the 7th against the 3rd
    // and the 5th: the 5th takes the 3rd, so the 7th still has the 5th.
    const ends: Line[] = [
      { date: "2026-09-01", amountCents: 999 },
      { date: "2026-09-20", amountCents: 998 },
    ];
    const upload: Line[] = [
      ...ends,
      { date: "2026-09-05", amountCents: 500 },
      { date: "2026-09-07", amountCents: 500 },
    ];
    const link: Line[] = [
      ...ends,
      { date: "2026-09-03", amountCents: 500 },
      { date: "2026-09-05", amountCents: 500 },
    ];
    const got = matchLines(upload, link, 2);
    expect(got.upload.matched).toBe(2);
    expect(got.link.matched).toBe(2);
  });

  it("finishes in well under a second with two thousand lines a side", () => {
    // Two different checking accounts at one bank over two years: nothing alike.
    const make = (amount: number): Line[] =>
      Array.from({ length: 2000 }, (_, i) => ({
        date: addDays("2025-01-01", i % 700),
        amountCents: amount + (i % 7),
      }));
    const started = Date.now();
    const got = compare(make(1000), make(3000));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(["different", "unknown"]).toContain(got.verdict);
  });

  it("keeps the thresholds in the config, with a gap between same and different", () => {
    expect(DIFFERENT_ACCOUNT_MAX_RATIO).toBeLessThan(SAME_ACCOUNT_MATCH_RATIO);
    expect(SAME_ACCOUNT_MAX_LINES).toBeGreaterThan(SAME_ACCOUNT_MIN_LINES);
  });
});

describe("the link's balance on a day", () => {
  it("is read only if its history reaches it", () => {
    const readings = [
      { date: "2026-10-29", balanceCents: 100 },
      { date: "2026-10-20", balanceCents: 5 },
    ];
    expect(balanceOnOrBefore(readings, "2026-10-31", 3)).toBe(100);
    expect(balanceOnOrBefore(readings, "2026-11-30", 3)).toBeNull();
    expect(balanceOnOrBefore(readings, "2026-10-10", 3)).toBeNull();
  });
});
