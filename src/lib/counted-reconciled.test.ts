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
  it("counts two like lines on the link as two, and a third on the copy as one more", () => {
    const counting = chain([["upload", "link", "copy"]]);
    const folded = foldCopiesInto(counting, [
      line("link", "2026-03-01", -50_000),
      line("link", "2026-03-01", -50_000),
      line("upload", "2026-03-01", -50_000),
      line("upload", "2026-03-01", -50_000),
      line("upload", "2026-03-01", -50_000),
    ]);
    expect(folded).toHaveLength(3);
  });
});
