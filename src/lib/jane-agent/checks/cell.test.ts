import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCell } from "./cell";

// A walked cell's cell.json (./cell.ts): which account each uploaded file goes to.
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/one-checking";

describe("a cell's files", () => {
  it("parse the sample cell", () => {
    expect(parseCell(readFileSync(join(CELL, "cell.json"), "utf8"), CELL)).toEqual({
      accounts: [
        {
          name: "Chase checking",
          kind: "checking",
          balance: "2,414.56",
          files: ["chase-checking-2026-10.csv"],
        },
      ],
    });
  });

  it.each([
    [{}, /at least one account/],
    [{ accounts: [{ kind: "checking", files: ["a.csv"] }] }, /needs a name/],
    [{ accounts: [{ name: "A", kind: "brokerage", files: ["a.csv"] }] }, /upload account kind/],
    [{ accounts: [{ name: "A", kind: "checking", balance: 12, files: ["a.csv"] }] }, /text typed/],
    [{ accounts: [{ name: "A", kind: "checking", files: [] }] }, /files uploaded/],
  ])("refuse %j", (cell, error) => {
    expect(() => parseCell(JSON.stringify(cell), "cell")).toThrow(error);
  });
});
