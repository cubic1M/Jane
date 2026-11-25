import { describe, expect, it } from "vitest";
import { countingProblems } from "@/sweep/counted";
import { accountsLeftOut, type CountAcct } from "./books";

// CodeRabbit on #2259: with uploads A and B of one account and a link L, what is held back, and why,
// must not depend on which id sorts first. L counts; B is held back as a maybe-copy of L; A as the
// earlier upload of B. Said in every id order, with and without "This is a different account".

const ORDERS = [
  ["a", "b", "l"],
  ["a", "l", "b"],
  ["b", "a", "l"],
  ["b", "l", "a"],
  ["l", "a", "b"],
  ["l", "b", "a"],
];
const bankOf = (a: CountAcct) => (a.itemId ? "Chase" : null);

function three(order: string[]) {
  const id = (role: string) => `acc_${order.indexOf(role)}_${role}`;
  const base = { type: "depository", subtype: "checking", mask: null } as const;
  const A: CountAcct = {
    ...base,
    id: id("a"),
    itemId: null,
    source: "csv",
    name: "Chase checking",
  };
  const B: CountAcct = {
    ...base,
    id: id("b"),
    itemId: null,
    source: "csv",
    name: "Chase checking",
  };
  const L: CountAcct = {
    ...base,
    id: id("l"),
    itemId: "item_chase",
    source: "plaid",
    name: "TOTAL CHECKING",
    mask: "1234",
  };
  return { A, B, L, all: [A, B, L] };
}
const endsOn = (s: { A: CountAcct; B: CountAcct }) =>
  new Map([
    [s.A.id, "2026-09-30"],
    [s.B.id, "2026-10-31"],
  ]);
const counted = (all: CountAcct[], left: Map<string, unknown>) =>
  all.filter((a) => !left.has(a.id));

describe("uploads A and B of one account, and the link L", () => {
  it.each(ORDERS)("%s: L counts, B is held for L, A for B", (...order) => {
    const s = three(order);
    const left = accountsLeftOut(s.all, { bankOf, endsOn: endsOn(s) });
    expect(left.get(s.B.id)).toMatchObject({ reason: "maybe_same", sameAs: { id: s.L.id } });
    expect(left.get(s.A.id)).toMatchObject({ reason: "older_upload", sameAs: { id: s.B.id } });
    expect(counted(s.all, left).map((a) => a.id)).toEqual([s.L.id].sort());
    expect(countingProblems(counted(s.all, left), bankOf)).toEqual([]);
  });

  it.each(ORDERS)("%s: B said to be a different account counts; A stays behind B", (...order) => {
    const s = three(order);
    const separate = new Set([s.B.id]);
    const left = accountsLeftOut(s.all, { bankOf, endsOn: endsOn(s), separate });
    expect(left.has(s.B.id)).toBe(false);
    expect(left.get(s.A.id)).toMatchObject({ reason: "older_upload", sameAs: { id: s.B.id } });
    const kept = counted(s.all, left);
    expect(kept.map((a) => a.id).sort()).toEqual([s.B.id, s.L.id].sort());
    expect(countingProblems(kept, bankOf, separate)).toEqual([]);
  });

  it.each(ORDERS)("%s: A said to be a different account counts; B stays held for L", (...order) => {
    const s = three(order);
    const separate = new Set([s.A.id]);
    const left = accountsLeftOut(s.all, { bankOf, endsOn: endsOn(s), separate });
    expect(left.has(s.A.id)).toBe(false);
    expect(left.get(s.B.id)).toMatchObject({ reason: "maybe_same", sameAs: { id: s.L.id } });
    expect(countingProblems(counted(s.all, left), bankOf, separate)).toEqual([]);
  });

  it.each(ORDERS)("%s: the later statement counts whichever upload it is", (...order) => {
    const s = three(order);
    const flipped = new Map([
      [s.A.id, "2026-10-31"],
      [s.B.id, "2026-09-30"],
    ]);
    const left = accountsLeftOut(s.all, { bankOf, endsOn: flipped });
    expect(left.get(s.B.id)).toMatchObject({ reason: "older_upload", sameAs: { id: s.A.id } });
    expect(left.get(s.A.id)).toMatchObject({ reason: "maybe_same" });
  });

  it("settles a tie on the statement's end day by who was uploaded last, then the newer id", () => {
    const s = three(["a", "b", "l"]);
    const same = new Map([
      [s.A.id, "2026-10-31"],
      [s.B.id, "2026-10-31"],
    ]);
    const byTime = accountsLeftOut(s.all, {
      bankOf,
      endsOn: same,
      uploadedAt: new Map([
        [s.A.id, "2026-11-02T10:00:00.000Z"],
        [s.B.id, "2026-11-01T10:00:00.000Z"],
      ]),
    });
    expect(byTime.get(s.B.id)).toMatchObject({ reason: "older_upload", sameAs: { id: s.A.id } });
    const byId = accountsLeftOut(s.all, { bankOf, endsOn: same });
    expect(byId.get(s.A.id)).toMatchObject({ reason: "older_upload", sameAs: { id: s.B.id } });
  });

  it("holds an earlier upload behind the latest of three, not the middle one", () => {
    const s = three(["a", "b", "l"]);
    const C: CountAcct = { ...s.B, id: "acc_9_c" };
    const ends = new Map([
      [s.A.id, "2026-08-31"],
      [s.B.id, "2026-09-30"],
      [C.id, "2026-10-31"],
    ]);
    const left = accountsLeftOut([s.A, s.B, C], { bankOf, endsOn: ends });
    expect(left.get(s.A.id)).toMatchObject({ sameAs: { id: C.id } });
    expect(left.get(s.B.id)).toMatchObject({ sameAs: { id: C.id } });
    expect(left.has(C.id)).toBe(false);
  });
});
