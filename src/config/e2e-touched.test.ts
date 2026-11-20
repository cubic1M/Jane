import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AREA_ROUTES,
  pushNeedsE2e,
  routesIn,
  routesOf,
  touchedSpecs,
} from "../../scripts/e2e-touched-core.mjs";

// Which end-to-end specs a change could break (npm run e2e:touched, scripts/e2e-touched-core.mjs).
// Twice in twelve hours an area page's change passed its PR, which runs only the @critical specs,
// and failed main: #2161 (src/lib/area-pages/insurance.ts) broke e2e/insurance.spec.ts:66, and
// #2166 (src/lib/area-pages/money.ts) e2e/hubs.spec.ts:20 (11-20).

const specs = readdirSync("e2e", { recursive: true })
  .filter((f) => String(f).endsWith(".ts"))
  .map((f) => ({
    file: join("e2e", String(f)),
    text: readFileSync(join("e2e", String(f)), "utf8"),
  }));
const files = (changedPaths: string[], diff = "") =>
  touchedSpecs({ changedPaths, diff, specs }).map((s) => s.file);

describe("the pages a changed file renders", () => {
  it("reads an area module, an app route and the hubs", () => {
    expect(routesOf("src/lib/area-pages/insurance.ts")).toEqual(["/insurance"]);
    expect(routesOf("src/lib/area-pages/loans-load.ts")).toEqual(["/loans"]);
    expect(routesOf("src/lib/area-pages/investing.ts")).toEqual(["/investments"]);
    expect(routesOf("src/app/insurance/claims/page.tsx")).toEqual(["/insurance"]);
    expect(routesOf("src/app/(auth)/login/page.tsx")).toEqual(["/login"]);
    expect(routesOf("src/components/hub/tile.tsx")).toEqual(["/home", ...AREA_ROUTES]);
  });

  it("says when a shared area-page file's page can't be told, and when a file renders none", () => {
    expect(routesOf("src/lib/area-pages/tree.ts")).toBeNull();
    expect(routesOf("src/app/api/plaid/webhook/route.ts")).toEqual([]);
    expect(routesOf("src/lib/jane-agent/intents.ts")).toEqual([]);
  });
});

describe("the pages a spec opens", () => {
  it("reads its goto() paths, a list it loops over, its helpers' and a crawl", () => {
    expect([...routesIn('await page.goto("/insurance/claims");')]).toEqual(["/insurance"]);
    expect([
      ...routesIn('for (const path of ["/money", "/loans"]) await page.goto(path);'),
    ]).toEqual(["/money", "/loans"]);
    expect([
      ...routesIn(
        'import { upload } from "./demo-upload";',
        new Map([["demo-upload", new Set(["/import"])]]),
      ),
    ]).toEqual(["/import"]);
    expect(routesIn('import { crawl } from "./crawl";').has("*")).toBe(true);
    // A link it only expects isn't a page it opens.
    expect([
      ...routesIn('await page.goto("/home"); expect(link).toHaveAttribute("href", "/loans");'),
    ]).toEqual(["/home"]);
  });
});

describe("the specs a change could break", () => {
  it("picks e2e/insurance.spec.ts for #2161's change", () => {
    const chosen = touchedSpecs({ changedPaths: ["src/lib/area-pages/insurance.ts"], specs });
    expect(chosen.find((s) => s.file === "e2e/insurance.spec.ts")?.why).toEqual([
      "src/lib/area-pages/insurance.ts renders /insurance",
    ]);
  });

  it("picks e2e/hubs.spec.ts for #2166's change", () => {
    expect(files(["src/lib/area-pages/money.ts", "src/sweep/invariants.ts"])).toContain(
      "e2e/hubs.spec.ts",
    );
  });

  it("picks every area page's specs for a shared area-page file", () => {
    const chosen = files(["src/lib/area-pages/tree.ts"]);
    expect(chosen).toEqual(expect.arrayContaining(["e2e/insurance.spec.ts", "e2e/hubs.spec.ts"]));
  });

  it("picks a changed spec, and one that still expects wording a change removed", () => {
    expect(files(["e2e/hubs.spec.ts"])).toEqual(["e2e/hubs.spec.ts"]);
    const spec = {
      file: "e2e/zz-wording.spec.ts",
      text: 'await expect(page.getByText("No renters cover on file yet")).toBeVisible();',
    };
    const diff = [
      "--- a/src/lib/x.ts",
      "+++ b/src/lib/x.ts",
      "@@ -1 +1 @@",
      '-  label: "No renters cover on file yet",',
      '+  label: "Renters cover: not on file",',
    ].join("\n");
    const chosen = touchedSpecs({ changedPaths: ["src/lib/x.ts"], diff, specs: [spec] });
    expect(chosen).toEqual([
      { file: "e2e/zz-wording.spec.ts", why: ['still expects "no renters cover on"'] },
    ]);
  });

  it("picks nothing for a change no page shows", () => {
    expect(files(["src/lib/jane-agent/intents.ts", "docs/ci.md"])).toEqual([]);
  });
});

describe("a push that must wait for npm run e2e:touched", () => {
  const head = "5d990396a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0";

  it("waits on a page change with no pass on its last commit", () => {
    expect(
      pushNeedsE2e({
        changedPaths: ["src/lib/area-pages/money.ts", "docs/x.md"],
        head,
        passedOn: null,
      }),
    ).toEqual(["src/lib/area-pages/money.ts"]);
    expect(
      pushNeedsE2e({
        changedPaths: ["src/lib/area-pages/tree.ts"],
        head,
        passedOn: "1111111111111111111111111111111111111111\n",
      }),
    ).toEqual(["src/lib/area-pages/tree.ts"]);
  });

  it("goes once it passed on this commit, or when no page changed", () => {
    expect(
      pushNeedsE2e({ changedPaths: ["src/lib/area-pages/money.ts"], head, passedOn: `${head}\n` }),
    ).toEqual([]);
    expect(
      pushNeedsE2e({ changedPaths: ["src/lib/jane-agent/intents.ts"], head, passedOn: null }),
    ).toEqual([]);
  });
});
