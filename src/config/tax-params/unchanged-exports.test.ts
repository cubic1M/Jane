import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as equity from "@/config/equity-tax";
import * as rates from "@/config/tax-rates";

// Tax T1 moved the federal figures into src/config/tax-params/us-2026.ts and left tax-rates.ts and
// equity-tax.ts as shims. No figure may change in that step. exports.golden.json was written from
// the files as they were on origin/main before the move (GOLDEN_WRITE=1 writes it); this test is
// the proof that every exported figure still has the same value, to the cent.
const GOLDEN = join(__dirname, "exports.golden.json");

const dump = (mod: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(mod)
      .filter(([, v]) => typeof v !== "function")
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const current = { "tax-rates": dump(rates), "equity-tax": dump(equity) };

describe("the old exports keep their values after the move to tax-params", () => {
  if (process.env.GOLDEN_WRITE === "1" && !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(current, null, 1) + "\n");
  }
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as typeof current;

  for (const file of ["tax-rates", "equity-tax"] as const) {
    for (const [name, value] of Object.entries(golden[file])) {
      it(`${file}: ${name}`, () => {
        expect(
          JSON.parse(JSON.stringify((current[file] as Record<string, unknown>)[name])),
        ).toEqual(value);
      });
    }
  }

  it("exports no new name and drops none", () => {
    expect(Object.keys(current["tax-rates"])).toEqual(Object.keys(golden["tax-rates"]));
    expect(Object.keys(current["equity-tax"])).toEqual(Object.keys(golden["equity-tax"]));
  });

  it("is the same data overall (hash)", () => {
    const h = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
    expect(h(JSON.parse(JSON.stringify(current)))).toBe(h(golden));
  });
});
