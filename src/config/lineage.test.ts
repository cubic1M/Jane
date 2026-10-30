import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LINEAGE } from "./lineage";

// Every table with a userId says where its rows come from and, if they're worked out from the
// data, how they go once that data is gone (card-chat mismatch: actions approved on the demo
// bank outlived its disconnect and were reported as savings).
const schema = readFileSync("prisma/schema.prisma", "utf8");
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({
  name,
  owned: /^\s+userId\s/m.test(body),
}));

describe("lineage of every user-owned table", () => {
  it("classes every model with a userId", () => {
    const owned = models.filter((m) => m.owned).map((m) => m.name);
    expect(owned.length).toBeGreaterThan(100);
    expect(
      owned.filter((name) => !(name in LINEAGE)),
      "add each new table to src/config/lineage.ts, saying how its rows go with their source",
    ).toEqual([]);
  });

  it("lists no table that is gone or has no userId", () => {
    const owned = new Set(models.filter((m) => m.owned).map((m) => m.name));
    expect(Object.keys(LINEAGE).filter((name) => !owned.has(name))).toEqual([]);
  });
});
