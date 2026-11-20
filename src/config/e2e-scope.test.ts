import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { touchedSpecs } from "../../scripts/e2e-touched-core.mjs";
import { changedSpecs, SCOPE_SPEC_CAP, scopeSpecs } from "../../scripts/test-scope-core.mjs";

// CI's test scope runs, beyond @critical, the end-to-end specs a PR's change could break, by the
// one mapping npm run e2e:touched uses (scripts/e2e-touched-core.mjs). #2161
// (src/lib/area-pages/insurance.ts) and #2166 (src/lib/area-pages/money.ts) passed their PRs and
// failed main on e2e/insurance.spec.ts:66 and e2e/hubs.spec.ts:20 (11-20).

const specs = readdirSync("e2e", { recursive: true })
  .filter((f) => String(f).endsWith(".ts"))
  .map((f) => ({
    file: join("e2e", String(f)),
    text: readFileSync(join("e2e", String(f)), "utf8"),
  }));
const scope = (changedPaths: string[]) => scopeSpecs({ changedPaths, specs });

describe("one mapping for npm run e2e:touched and CI's scope", () => {
  it("is imported by both, and defined in neither", () => {
    for (const file of ["scripts/e2e-touched.mjs", "scripts/test-scope-core.mjs"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toMatch(/from "\.\/e2e-touched-core\.mjs"/);
      expect(text, file).not.toMatch(/function (?:routesOf|routesIn|touchedSpecs)\b/);
    }
  });

  it.each([
    [["src/lib/area-pages/insurance.ts"]],
    [["src/lib/area-pages/money.ts", "src/sweep/invariants.ts"]],
    [["src/app/loans/page.tsx"]],
    [["e2e/hubs.spec.ts", "docs/ci.md"]],
  ])("chooses what the script chooses for %j, under the cap", (changedPaths) => {
    const script = touchedSpecs({ changedPaths, specs }).map((s) => s.file);
    if (script.length > SCOPE_SPEC_CAP) throw new Error(`${script.length} specs: past the cap`);
    expect(scope(changedPaths).files).toEqual(script);
  });
});

describe("what a PR's CI runs beyond @critical", () => {
  it("runs the spec #2161 broke, and the one #2166 broke", () => {
    expect(scope(["src/lib/area-pages/insurance.ts"]).files).toContain("e2e/insurance.spec.ts");
    expect(
      scope([
        "src/lib/area-pages/money.ts",
        "src/lib/area-pages/regular-charges-line.test.ts",
        "src/sweep/invariants.ts",
      ]).files,
    ).toContain("e2e/hubs.spec.ts");
  });

  it("is unchanged for a PR that touches no page: the spec files it changes, or none", () => {
    for (const changedPaths of [
      ["src/lib/jane-agent/intents.ts", "src/lib/jane-agent/replies-fees.ts"],
      ["src/profile/build.ts", "src/planning/student-tax.ts", "docs/ci.md"],
      ["e2e/hubs.spec.ts", "src/lib/anthropic.ts"],
    ]) {
      expect(scope(changedPaths).files).toEqual(changedSpecs(changedPaths));
    }
  });

  it("caps a change that reaches a great many, the closest first, and names the rest", () => {
    const { files, left } = scope(["src/components/hub/tile.tsx", "e2e/zz-not-a-spec.spec.ts"]);
    expect(files).toHaveLength(SCOPE_SPEC_CAP);
    expect(left.length).toBeGreaterThan(0);
    // Specs named for the hubs' pages come before the rest of the set.
    expect(files).toEqual(expect.arrayContaining(["e2e/hubs.spec.ts", "e2e/home.spec.ts"]));
  });

  it("runs the area pages' specs when it can't tell which page a change is (never none)", () => {
    const { files } = scope(["src/lib/area-pages/tree.ts"]);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual(expect.arrayContaining(["e2e/insurance.spec.ts", "e2e/hubs.spec.ts"]));
  });
});
