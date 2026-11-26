import { describe, expect, it, vi } from "vitest";

const readCsvFile = vi.hoisted(() => vi.fn());
vi.mock("@/data-sources/csv/csv-source", () => ({ readCsvFile }));

import { linkedVerdicts } from "./linked-verdicts";

// A statement and a linked account compared as net worth compares them
// (src/planning/same-account.ts), before the file is in.
const file = { name: "f.csv", text: "" };
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const lines = (amounts: number[]) => amounts.map((a, i) => ({ date: day(i + 1), amountCents: a }));
const AMOUNTS = Array.from({ length: 24 }, (_, i) => -(1000 + i * 137));

function db(linkLines: { date: string; amountCents: number }[]) {
  return {
    accounts: {
      findMany: vi.fn().mockResolvedValue([{ id: "l1", item: { institutionName: "Chase" } }]),
    },
    transactions: {
      findMany: vi.fn().mockResolvedValue(
        linkLines.map((l) => ({
          date: new Date(`${l.date}T00:00:00Z`),
          amountCents: l.amountCents,
        })),
      ),
    },
    balanceSnapshots: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;
}

function read(amounts: number[]) {
  readCsvFile.mockReturnValue({
    ok: true,
    file: "f.csv",
    format: { bank: "Chase" },
    transactions: lines(amounts),
    balances: [],
  });
}

describe("linkedVerdicts", () => {
  it("says same for a statement whose lines are the linked account's", async () => {
    read(AMOUNTS);
    expect(await linkedVerdicts(db(lines(AMOUNTS)), [file])).toEqual({
      "f.csv": { l1: "same" },
    });
  });

  it("says different for a statement that shares none of them", async () => {
    read(AMOUNTS);
    const other = lines(AMOUNTS.map((a) => a - 12_345));
    expect(await linkedVerdicts(db(other), [file])).toEqual({ "f.csv": { l1: "different" } });
  });

  it("says unknown with too few lines, and nothing for a file with no known bank", async () => {
    read(AMOUNTS.slice(0, 2));
    expect(await linkedVerdicts(db(lines(AMOUNTS)), [file])).toEqual({
      "f.csv": { l1: "unknown" },
    });
    readCsvFile.mockReturnValue({ ok: true, file: "f.csv", format: {}, transactions: [] });
    expect(await linkedVerdicts(db([]), [file])).toEqual({});
  });
});
