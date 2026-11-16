import { describe, expect, it } from "vitest";
import { atLocal, changes, daysFrom, flatten, unexplained } from "./diff";

// The calendar sweep's own rules (src/sweep/): flattening, comparing, the days and local hours it
// steps through, and which changes count as explained.

describe("the calendar sweep's comparisons", () => {
  it("flattens a value to one leaf per path, dates as ISO text", () => {
    expect(
      flatten({
        home: { cents: 252_000, on: new Date("2026-11-15T00:00:00Z"), why: [{ cents: 1 }, null] },
        gone: undefined,
        f: () => 1,
      }),
    ).toEqual({
      "home.cents": 252_000,
      "home.on": "2026-11-15T00:00:00.000Z",
      "home.why.length": 2,
      "home.why.0.cents": 1,
      "home.why.1": null,
    });
  });

  it("keys a list by its entries' ids, so one coming or going doesn't shift the rest", () => {
    const tree = (ids: string[]) => flatten({ items: ids.map((id) => ({ id, label: id })) });
    expect(changes(tree(["coming:week", "coming:month"]), tree(["coming:month"]))).toEqual([
      { path: "items.coming:week.id", before: "coming:week", after: undefined },
      { path: "items.coming:week.label", before: "coming:week", after: undefined },
      { path: "items.length", before: 2, after: 1 },
    ]);
    // By key when there's no id; by position when names are missing or repeat.
    expect(flatten({ tiles: [{ key: "money", v: 1 }] })).toEqual({
      "tiles.length": 1,
      "tiles.money.key": "money",
      "tiles.money.v": 1,
    });
    expect(flatten({ l: [{ id: "a" }, { id: "a" }] })).toEqual({
      "l.length": 2,
      "l.0.id": "a",
      "l.1.id": "a",
    });
  });

  it("lists exactly what differs, added and removed paths included", () => {
    expect(changes({ a: 1, b: "x", c: true }, { a: 1, b: "y", d: 0 })).toEqual([
      { path: "b", before: "x", after: "y" },
      { path: "c", before: true, after: undefined },
      { path: "d", before: undefined, after: 0 },
    ]);
  });

  it("steps through every day, month ends and a leap day included", () => {
    expect(daysFrom("2028-02-27", "2028-03-01")).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
    expect(daysFrom("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("finds 3pm and 7pm in Los Angeles on either side of a DST change", () => {
    // Before Nov 1 2026 Los Angeles is UTC-7; after, UTC-8.
    expect(atLocal("2026-10-31", 15, "America/Los_Angeles").toISOString()).toBe(
      "2026-10-31T22:00:00.000Z",
    );
    expect(atLocal("2026-11-01", 19, "America/Los_Angeles").toISOString()).toBe(
      "2026-11-02T03:00:00.000Z",
    );
    expect(atLocal("2027-03-14", 15, "America/Los_Angeles").toISOString()).toBe(
      "2027-03-14T22:00:00.000Z",
    );
    expect(atLocal("2026-11-15", 15, "Asia/Kolkata").toISOString()).toBe(
      "2026-11-15T09:30:00.000Z",
    );
  });

  it("counts a change as explained only by a reason for its path, on that reason's days", () => {
    const found = [
      { path: "bills.0.inDays", before: 3, after: 2 },
      { path: "home.safeToSpend", before: 100, after: 90 },
      { path: "home.monthSpent", before: 500, after: 0 },
    ];
    const reasons = [
      { name: "days until", paths: /\.inDays$/ },
      { name: "a new month", paths: /^home\.month/, on: (day: string) => day.endsWith("-01") },
    ];
    expect(unexplained("2026-12-01", found, reasons).map((c) => c.path)).toEqual([
      "home.safeToSpend",
    ]);
    expect(unexplained("2026-12-02", found, reasons).map((c) => c.path)).toEqual([
      "home.safeToSpend",
      "home.monthSpent",
    ]);
  });

  it("lets a reason fall on one of the person's own days", () => {
    const found = [{ path: "chat.spend.body", before: "a", after: "b" }];
    const reasons = [
      {
        name: "the data ending",
        paths: /^chat\.spend\./,
        on: (day: string, p: { linked: string; lastLine: string }) =>
          day === `${p.lastLine.slice(0, 8)}${Number(p.lastLine.slice(8)) + 15}`,
      },
    ];
    const person = { linked: "2026-10-25", lastLine: "2026-10-12" };
    expect(unexplained("2026-10-27", found, reasons, person)).toEqual([]);
    expect(unexplained("2026-10-28", found, reasons, person)).toEqual(found);
  });

  it("counts a summary as explained only when what it sums up moved for a reason that day", () => {
    const reasons = [
      { name: "a charge that stopped", paths: /^trees\.money\.tree\.branches\.subs\./ },
      {
        name: "a tree's items",
        paths: /^trees\.[^.]+\.tree\.sub$/,
        follows: (path: string) => new RegExp(`^${path.replace(/\.sub$/, "")}\\.branches\\.`),
      },
    ];
    const sub = { path: "trees.money.tree.sub", before: "3 to look at", after: "2 to look at" };
    const stopped = { path: "trees.money.tree.branches.subs.items.length", before: 2, after: 1 };
    const other = { path: "trees.money.tree.branches.budgets.items.length", before: 1, after: 0 };
    const elsewhere = { path: "trees.loans.tree.branches.subs.items.length", before: 2, after: 1 };
    expect(unexplained("2026-12-02", [sub, stopped], reasons)).toEqual([]);
    // Its items moved for no reason: both are findings.
    expect(unexplained("2026-12-02", [sub, other], reasons)).toEqual([sub, other]);
    // Nothing of its own moved, or only another tree's.
    expect(unexplained("2026-12-02", [sub], reasons)).toEqual([sub]);
    expect(unexplained("2026-12-02", [sub, elsewhere], reasons)).toEqual([sub, elsewhere]);
  });
});
