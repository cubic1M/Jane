import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cohensKappa,
  drops,
  isInsideRepo,
  joinSheets,
  outsideRepo,
  scoreLabels,
  scoreTable,
  seal,
  unseal,
  type LabelledRow,
} from "./labels";
import { SEALED, prepare, score, sealSheets } from "./run";
import { readSheet, sheetFromStatements } from "./sheet";

vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));

const row = (id: string, a: string, b = a): LabelledRow => ({
  id,
  date: "2026-10-01",
  amountCents: 1000,
  description: `SECRET SHOP ${id}`,
  a,
  b,
});
const KEY = randomBytes(32).toString("base64");

describe("scoring by category", () => {
  it("scores a rare category on its own, so it can't hide in an average", () => {
    // 98 of 100 common rows right; the 2 rare ones both wrong.
    const rows = [
      ...Array.from({ length: 100 }, (_, i) => row(`c${i}`, "FOOD_AND_DRINK")),
      row("r1", "RENT_AND_UTILITIES"),
      row("r2", "RENT_AND_UTILITIES"),
    ];
    const predicted = new Map<string, string | null>(rows.map((r) => [r.id, r.a]));
    predicted.set("c0", "GENERAL_MERCHANDISE");
    predicted.set("c1", null);
    predicted.set("r1", "FOOD_AND_DRINK");
    predicted.set("r2", "FOOD_AND_DRINK");
    const s = scoreLabels(rows, predicted);
    expect(s.accuracy).toBeCloseTo(98 / 102);
    const rare = s.categories.find((c) => c.category === "RENT_AND_UTILITIES")!;
    expect(rare).toMatchObject({ support: 2, right: 0, recall: 0 });
    expect(s.macroRecall).toBeLessThan(0.5);
    expect(s.unsorted).toBe(1);
  });

  it("flags a rare category's drop however good the average stays", () => {
    const rows = [
      ...Array.from({ length: 500 }, (_, i) => row(`c${i}`, "FOOD_AND_DRINK")),
      ...Array.from({ length: 5 }, (_, i) => row(`r${i}`, "RENT_AND_UTILITIES")),
    ];
    const allRight = new Map<string, string | null>(rows.map((r) => [r.id, r.a]));
    const before = scoreLabels(rows, allRight);
    const worse = new Map(allRight).set("r0", null);
    const now = scoreLabels(rows, worse);
    expect(now.accuracy).toBeGreaterThan(0.99);
    expect(drops(before, now)).toEqual(["RENT_AND_UTILITIES recall fell from 100.0% to 80.0%"]);
  });

  it("scores only rows both founders agree on, and counts the rest", () => {
    const rows = [
      row("1", "FOOD_AND_DRINK"),
      row("2", "FOOD_AND_DRINK", "GENERAL_MERCHANDISE"),
      row("3", "UNSURE", "FOOD_AND_DRINK"),
    ];
    const s = scoreLabels(rows, new Map([["1", "FOOD_AND_DRINK"]]));
    expect(s).toMatchObject({ labelled: 3, agreed: 1, disagreed: 1, unsure: 1 });
    expect(s.categories).toHaveLength(1);
  });

  it("measures how far past chance the founders agree", () => {
    expect(
      cohensKappa([
        ["A", "A"],
        ["B", "B"],
      ]),
    ).toBe(1);
    expect(
      cohensKappa([
        ["A", "B"],
        ["B", "A"],
      ]),
    ).toBeLessThan(0);
    expect(cohensKappa([])).toBeNull();
  });
});

describe("the sealed file", () => {
  it("opens with its key and no other", () => {
    const sealed = seal([row("1", "FOOD_AND_DRINK")], KEY);
    expect(sealed).not.toContain("SECRET");
    expect(unseal(sealed, KEY)[0]?.description).toBe("SECRET SHOP 1");
    expect(() => unseal(sealed, randomBytes(32).toString("base64"))).toThrow();
  });

  it("notices a change to the file", () => {
    const sealed = seal([row("1", "FOOD_AND_DRINK")], KEY);
    const changed = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => unseal(changed, KEY)).toThrow();
  });

  it("refuses a short key", () => {
    expect(() => seal([], Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });

  it("refuses a folder inside this repo", () => {
    expect(isInsideRepo(process.cwd())).toBe(true);
    expect(() => outsideRepo(join(process.cwd(), "labels"))).toThrow(/outside the repo/);
    expect(() => prepare(process.cwd())).toThrow(/outside the repo/);
    expect(isInsideRepo(tmpdir())).toBe(false);
  });
});

describe("the two founders' sheets", () => {
  it("joins on the row, and says which labels aren't categories without saying the row", () => {
    const sheet = [
      { ...row("1", ""), label: "food_and_drink" },
      { ...row("2", ""), label: "NOPE" },
    ];
    const joined = joinSheets(sheet, [
      { id: "1", label: "FOOD_AND_DRINK" },
      { id: "2", label: "FOOD_AND_DRINK" },
    ]);
    expect(joined.rows[0]).toMatchObject({ a: "FOOD_AND_DRINK", b: "FOOD_AND_DRINK" });
    expect(joined.badLabels).toEqual(["2: NOPE"]);
    expect(JSON.stringify(joined.badLabels)).not.toContain("SECRET");
  });

  it("counts rows only one founder labelled", () => {
    const joined = joinSheets([{ ...row("1", ""), label: "FOOD_AND_DRINK" }], []);
    expect(joined).toMatchObject({ rows: [], onlyOne: 1 });
  });

  it("makes a sheet from a statement with no guess in it, and reads it back", () => {
    const { sheet, rows } = sheetFromStatements([
      {
        name: "chase.csv",
        text: [
          "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
          '10/01/2026,10/02/2026,"NETFLIX, INC",Entertainment,Sale,-15.49,',
          '10/01/2026,10/02/2026,"NETFLIX, INC",Entertainment,Sale,-15.49,',
        ].join("\n"),
      },
    ]);
    expect(rows).toBe(2);
    const read = readSheet(sheet);
    expect(read[0]).toMatchObject({
      date: "2026-10-02",
      amountCents: 1549,
      description: "NETFLIX, INC",
      bankCategory: "Entertainment",
      label: "",
    });
    // Two real rows keep two ids.
    expect(read[0]?.id).not.toBe(read[1]?.id);
  });
});

describe("the whole path", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jane-labels-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const STATEMENT = [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "10/01/2026,10/02/2026,PRIVATE SHOP NAME,Shopping,Sale,-15.49,",
    "10/01/2026,10/02/2026,NETFLIX.COM,Entertainment,Sale,-15.49,",
    "10/03/2026,10/04/2026,CHIPOTLE 1234,Food & Drink,Sale,-11.00,",
  ].join("\n");

  function labelled(label: (description: string) => string) {
    const sheet = readFileSync(join(dir, "to-label.csv"), "utf8");
    return sheet
      .trimEnd()
      .split("\n")
      .map((line, i) => (i === 0 ? line : `${line}${label(line)}`))
      .join("\n");
  }

  it("prints scores only, and holds a drop against the scores it kept", async () => {
    mkdirSync(join(dir, "statements"));
    writeFileSync(join(dir, "statements", "card.csv"), STATEMENT);
    expect(prepare(dir)).toContain("3 rows");

    const truth = (line: string) =>
      /CHIPOTLE/.test(line)
        ? "FOOD_AND_DRINK"
        : /NETFLIX/.test(line)
          ? // Not what the rules say, so there's a score to fall from below.
            "TRAVEL"
          : "GENERAL_MERCHANDISE";
    writeFileSync(join(dir, "labels-a.csv"), labelled(truth));
    writeFileSync(join(dir, "labels-b.csv"), labelled(truth));
    const said = sealSheets(dir, KEY);
    expect(said).toContain("Sealed 3 rows");
    expect(readFileSync(join(dir, SEALED), "utf8")).not.toContain("PRIVATE");

    const first = await score(dir, KEY, { keepScores: true });
    expect(first.drops).toEqual([]);
    expect(first.table).toContain("| FOOD_AND_DRINK |");
    for (const secret of ["PRIVATE", "NETFLIX", "CHIPOTLE", "15.49", "2026"]) {
      expect(first.table).not.toContain(secret);
      expect(said).not.toContain(secret);
      expect(JSON.stringify(first.scores)).not.toContain(secret);
    }
    expect(readFileSync(join(dir, "scores.json"), "utf8")).not.toContain("NETFLIX");

    // The same rows scored worse than last time: the kept scores say what fell.
    const better = JSON.parse(readFileSync(join(dir, "scores.json"), "utf8"));
    for (const c of better.categories) {
      c.recall = 1;
      c.precision = 1;
    }
    writeFileSync(join(dir, "scores.json"), JSON.stringify(better));
    const second = await score(dir, KEY);
    expect(second.drops.length).toBeGreaterThan(0);
    expect(second.drops.join()).not.toContain("NETFLIX");
    expect(scoreTable(second.scores)).toContain("Founders' agreement (kappa): 1.00");
  });
});
