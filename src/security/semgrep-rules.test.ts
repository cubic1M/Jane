import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Semgrep rule for unscoped queries names every user-owned table, so a new table must join it
// (.semgrep/rules/jane.yaml, docs/security/scanners.md).
describe("the unscoped query rule", () => {
  it("names exactly the tables with a user id", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const owned = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+userId\s/m.test(body))
      .map(([, name]) => name[0].toLowerCase() + name.slice(1))
      .sort();
    const rule = readFileSync(".semgrep/rules/jane.yaml", "utf8");
    const listed = rule.match(/metavariable: \$MODEL\n\s+regex: \^\((.*)\)\$/)?.[1].split("|");
    expect(listed?.slice().sort()).toEqual(owned);
  });
});
