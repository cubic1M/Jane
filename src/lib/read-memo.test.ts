import { describe, expect, it, vi } from "vitest";
import { copyRows, forgetReads, memoKey, memoRead, READ_OPERATIONS, type Store } from "./read-memo";

describe("memoKey", () => {
  it("is the same for the same question and differs by user, table, operation and filter", () => {
    const a = memoKey("u1", "account", "findMany", { where: { source: "csv" } });
    expect(a).toBe(memoKey("u1", "account", "findMany", { where: { source: "csv" } }));
    expect(a).not.toBe(memoKey("u2", "account", "findMany", { where: { source: "csv" } }));
    expect(a).not.toBe(memoKey("u1", "plaidItem", "findMany", { where: { source: "csv" } }));
    expect(a).not.toBe(memoKey("u1", "account", "count", { where: { source: "csv" } }));
    expect(a).not.toBe(memoKey("u1", "account", "findMany", { where: { source: "plaid" } }));
  });

  it("tells dates apart by their moment", () => {
    const at = (iso: string) => memoKey("u", "t", "findMany", { where: { date: new Date(iso) } });
    expect(at("2026-10-01T00:00:00Z")).toBe(at("2026-10-01T00:00:00Z"));
    expect(at("2026-10-01T00:00:00Z")).not.toBe(at("2026-10-02T00:00:00Z"));
  });

  it("doesn't share what it can't tell apart: bigints and objects that aren't plain data", () => {
    class Marker {}
    expect(memoKey("u", "t", "findMany", { where: { n: BigInt(1) } })).toBeNull();
    expect(memoKey("u", "t", "findMany", { where: { n: new Marker() } })).toBeNull();
  });
});

describe("memoRead", () => {
  it("runs a repeated question once and hands each caller its own copy of the rows", async () => {
    const store: Store = new Map();
    const run = vi.fn(async () => [{ id: 1, nested: { a: 1 } }, { id: 2 }]);
    const [first, second] = await Promise.all([
      memoRead("k", run, store),
      memoRead("k", run, store),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    (first as { id: number }[]).sort((a, b) => b.id - a.id);
    (first as { id: number }[])[0].id = 99;
    expect(second).toEqual([{ id: 1, nested: { a: 1 } }, { id: 2 }]);
    expect(await memoRead("k", run, store)).toEqual([{ id: 1, nested: { a: 1 } }, { id: 2 }]);
  });

  it("runs a different question again, and a question with no key every time", async () => {
    const store: Store = new Map();
    const run = vi.fn(async () => 1);
    await memoRead("a", run, store);
    await memoRead("b", run, store);
    await memoRead(null, run, store);
    await memoRead(null, run, store);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("forgets everything when asked, so a read after a write asks again", async () => {
    const store: Store = new Map();
    let rows = [1];
    const run = vi.fn(async () => rows);
    expect(await memoRead("k", run, store)).toEqual([1]);
    rows = [1, 2];
    forgetReads(store);
    expect(await memoRead("k", run, store)).toEqual([1, 2]);
  });

  it("doesn't keep a failed read", async () => {
    const store: Store = new Map();
    const run = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue("ok");
    await expect(memoRead("k", run, store)).rejects.toThrow("down");
    await Promise.resolve();
    expect(await memoRead("k", run, store)).toBe("ok");
  });

  it("copies a single row and passes other results through", () => {
    const row = { id: 1 };
    expect(copyRows(row)).toEqual(row);
    expect(copyRows(row)).not.toBe(row);
    expect(copyRows(3)).toBe(3);
    expect(copyRows(null)).toBeNull();
  });
});

describe("READ_OPERATIONS", () => {
  it("is every Prisma read and no write", () => {
    expect([...READ_OPERATIONS].sort()).toEqual(
      [
        "aggregate",
        "count",
        "findFirst",
        "findFirstOrThrow",
        "findMany",
        "findUnique",
        "findUniqueOrThrow",
        "groupBy",
      ].sort(),
    );
    for (const write of ["create", "update", "upsert", "delete", "deleteMany", "createMany"]) {
      expect(READ_OPERATIONS.has(write)).toBe(false);
    }
  });
});
