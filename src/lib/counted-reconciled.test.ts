import { describe, expect, it } from "vitest";
import { countingOf, foldCopiesInto, reconcileLiabilities } from "@/lib/account-copies";
import type { Acct, LeftOut } from "@/planning/books";

// What a left-out copy knows that the account kept doesn't (CodeRabbit on #2259, ten comments, one
// cause): the helper hands it to the counted account, along the whole chain, with the date of the
// reading that gave it, and never adds a balance.

const acct = (id: string): Acct => ({
  id,
  itemId: null,
  name: id,
  mask: null,
  type: "loan",
  subtype: "mortgage",
});
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const chain = (pairs: [string, string, LeftOut["reason"]][]) =>
  countingOf(new Map(pairs.map(([id, to, reason]) => [id, { reason, sameAs: acct(to) }])));

describe("a left-out copy hands its facts to the counted account", () => {
  const row = (accountId: string, over: object = {}) => ({
    accountId,
    aprBps: null as number | null,
    ytdInterestPaidCents: null as number | null,
    lastPaymentDate: null as Date | null,
    updatedAt: day("2026-01-01"),
    account: { currentBalanceCents: 100 },
    ...over,
  });

  it("follows the chain upload -> upload -> link", () => {
    const counting = chain([
      ["u1", "u2", "older_upload"],
      ["u2", "link", "maybe_same"],
    ]);
    expect(counting.representativeOf("u1")).toBe("link");
    const out = reconcileLiabilities(counting, [
      row("link"),
      row("u2"),
      row("u1", { ytdInterestPaidCents: 54_300 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ accountId: "link", ytdInterestPaidCents: 54_300 });
  });

  it("takes the rate the kept link lacks, and keeps a rate it has", () => {
    const counting = chain([["copy", "link", "copy"]]);
    expect(
      reconcileLiabilities(counting, [row("link"), row("copy", { aprBps: 2400 })])[0],
    ).toMatchObject({
      aprBps: 2400,
    });
    expect(
      reconcileLiabilities(counting, [
        row("link", { aprBps: 1900 }),
        row("copy", { aprBps: 2400 }),
      ])[0],
    ).toMatchObject({ aprBps: 1900 });
  });

  it("moves the interest with the date of its own reading", () => {
    const counting = chain([["copy", "link", "copy"]]);
    const [kept] = reconcileLiabilities(counting, [
      row("link", {
        ytdInterestPaidCents: 100,
        lastPaymentDate: day("2026-11-01"),
        updatedAt: day("2026-11-02"),
      }),
      row("copy", {
        ytdInterestPaidCents: 90_000,
        lastPaymentDate: day("2025-12-15"),
        updatedAt: day("2025-12-31"),
      }),
    ]);
    // The larger figure is the December one, and it is read as December's, not as November's.
    expect(kept).toMatchObject({
      ytdInterestPaidCents: 90_000,
      lastPaymentDate: day("2025-12-15"),
      updatedAt: day("2025-12-31"),
    });
  });

  it("never adds the copy's balance", () => {
    const counting = chain([["copy", "link", "copy"]]);
    const [kept] = reconcileLiabilities(counting, [
      row("link"),
      row("copy", { account: { currentBalanceCents: 999_999 } }),
    ]);
    expect(kept.account.currentBalanceCents).toBe(100);
  });

  it("leaves everything alone with nothing left out", () => {
    const rows = [row("a"), row("b")];
    expect(reconcileLiabilities(countingOf(new Map()), rows)).toEqual(rows);
  });
});

describe("lines only a copy has count once", () => {
  const line = (accountId: string, date: string, amountCents: number) => ({
    accountId,
    date: day(date),
    amountCents,
  });
  it("keeps the upload's earlier contribution, and not the line both share", () => {
    const counting = chain([["upload", "link", "copy"]]);
    const folded = foldCopiesInto(counting, [
      line("link", "2026-03-01", -50_000),
      line("upload", "2026-01-10", -300_000),
      line("upload", "2026-03-01", -50_000),
    ]);
    expect(folded.map((l) => [l.accountId, l.amountCents]).sort()).toEqual([
      ["link", -300_000],
      ["link", -50_000],
    ]);
  });
  it("counts a line the link and two copies all show once, not once per copy", () => {
    const counting = chain([
      ["copy1", "link", "copy"],
      ["copy2", "link", "copy"],
    ]);
    const folded = foldCopiesInto(counting, [
      line("link", "2026-03-01", -50_000),
      line("copy1", "2026-03-01", -50_000),
      line("copy2", "2026-03-01", -50_000),
    ]);
    expect(folded).toHaveLength(1);
  });
  it("counts an earlier line two copies both show, with the link having none, once", () => {
    const counting = chain([
      ["copy1", "link", "copy"],
      ["copy2", "link", "copy"],
    ]);
    const folded = foldCopiesInto(counting, [
      line("copy1", "2026-01-10", -300_000),
      line("copy2", "2026-01-10", -300_000),
    ]);
    expect(folded).toEqual([line("link", "2026-01-10", -300_000)]);
  });
  it("keeps a line repeated on one account as repeated", () => {
    const counting = chain([["upload", "link", "copy"]]);
    const folded = foldCopiesInto(counting, [
      line("link", "2026-03-01", -50_000),
      line("link", "2026-03-01", -50_000),
      line("upload", "2026-03-01", -50_000),
    ]);
    expect(folded).toHaveLength(2);
  });
});

describe("interest said for a year comes from a reading taken in it", () => {
  const row = (accountId: string, ytd: number | null, readOn: string) => ({
    accountId,
    ytdInterestPaidCents: ytd,
    lastPaymentDate: null as Date | null,
    updatedAt: day(readOn),
  });
  const counting = chain([["copy", "link", "copy"]]);
  it("ignores a copy's larger reading from another year", () => {
    const [kept] = reconcileLiabilities(
      counting,
      [row("link", 100_000, "2026-11-02"), row("copy", 900_000, "2025-12-31")],
      { readingYear: 2026 },
    );
    expect(kept.ytdInterestPaidCents).toBe(100_000);
  });
  it("takes a copy's reading from that year when the account's own is from another", () => {
    const [kept] = reconcileLiabilities(
      counting,
      [row("link", 100_000, "2025-12-02"), row("copy", 40_000, "2026-10-01")],
      { readingYear: 2026 },
    );
    expect(kept).toMatchObject({ ytdInterestPaidCents: 40_000, updatedAt: day("2026-10-01") });
  });
  it("leaves the interest unknown when no reading is from that year", () => {
    const [kept] = reconcileLiabilities(
      counting,
      [row("link", 100_000, "2025-12-02"), row("copy", 900_000, "2025-12-31")],
      { readingYear: 2026 },
    );
    expect(kept.ytdInterestPaidCents).toBeNull();
  });
  it("keeps the larger of the year's own readings, the account's own on a tie", () => {
    const [a] = reconcileLiabilities(
      counting,
      [row("link", 100_000, "2026-11-02"), row("copy", 150_000, "2026-11-20")],
      { readingYear: 2026 },
    );
    expect(a).toMatchObject({ ytdInterestPaidCents: 150_000, updatedAt: day("2026-11-20") });
  });
});
