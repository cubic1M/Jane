import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCell } from "./cell";

// A walked cell with a brokerage's positions download (./cell.ts), as desktop sweep 5's upload S4.
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/upload-s4-desktop";

describe("a cell's positions files", () => {
  it("parse beside the statements", () => {
    expect(parseCell(readFileSync(join(CELL, "cell.json"), "utf8"), CELL)).toEqual({
      accounts: [{ name: "Chase checking", kind: "checking", files: ["chase-checking.csv"] }],
      positions: ["fidelity-positions.csv"],
    });
  });

  it.each([[[]], ["positions.csv"], [[""]], [[3]]])("refuse positions %j", (positions) => {
    const cell = { accounts: [{ name: "A", kind: "checking", files: ["a.csv"] }], positions };
    expect(() => parseCell(JSON.stringify(cell), "cell")).toThrow(/positions files uploaded/);
  });
});
