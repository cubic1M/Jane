import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { reportFor } from "@/detectors/harness";
import { INSURANCE_BRANCHES } from "./insurance";
import { INVESTING_ANCHORS, INVESTING_BRANCHES, PAGES, investingTree } from "./investing";
import { AREA_ANCHORS, isAreaRoot, landing, type AreaRoot } from "./landing";
import { LOANS_BRANCHES, loansTree } from "./loans";
import { DECISIONS, PLANS_BRANCHES } from "./plans";
import { TAXES_ANCHORS, TAXES_BRANCHES, TOPICS } from "./taxes";

// Every link Jane gives lands on something that exists (docs/design/area-pages.md): a page in
// src/app, and on an area page a node of its tree. Checked for the 8 sample people's
// suggestions (their buttons and "More" links) and for every page link written in the code.

const SRC = join(__dirname, "..", "..");
const APP = join(SRC, "app");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "generated" && name !== "node_modules") files(p, out);
    } else out.push(p);
  }
  return out;
}

// The app's pages and routes, as patterns: "[id]" matches any one segment, "(group)" none.
const ROUTES: RegExp[] = files(APP)
  .filter((f) => /\/(page|route)\.tsx?$/.test(f))
  .map((f) => {
    const segments = relative(APP, f)
      .split("/")
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => (/^\[\[?\.\.\./.test(s) ? ".*" : /^\[.*\]$/.test(s) ? "[^/]+" : s));
    return new RegExp(`^/${segments.join("/")}$`.replace("^/$", "^/$"));
  });
const TOP = new Set(
  readdirSync(APP).filter((n) => statSync(join(APP, n)).isDirectory() && !/^[([_]/.test(n)),
);
const isPage = (path: string) => ROUTES.some((r) => r.test(path.replace(/\/$/, "") || "/"));

// The nodes each area's tree can have whatever the person's data: its branches, and the items
// whose ids don't depend on the data.
const BRANCHES: Record<AreaRoot, readonly string[]> = {
  "/insurance": Object.keys(INSURANCE_BRANCHES),
  "/loans": Object.keys(LOANS_BRANCHES),
  "/taxes": Object.keys(TAXES_BRANCHES),
  "/investments": Object.keys(INVESTING_BRANCHES),
  "/ahead": Object.keys(PLANS_BRANCHES),
};
const FIXED: Record<AreaRoot, ReadonlySet<string>> = {
  "/insurance": new Set(["household:add", "health:deductible"]),
  "/loans": new Set(),
  "/taxes": new Set([
    ...Object.values(TAXES_ANCHORS),
    ...(["filing", "topics"] as const).flatMap((b) => TOPICS[b].map((t) => `${b}:${t.key}`)),
    ...["estimate", "withholding", "refund", "investments"].map((k) => `estimate:${k}`),
  ]),
  "/investments": new Set([
    ...Object.values(INVESTING_ANCHORS),
    ...(["plan", "kinds", "costs"] as const).flatMap((b) => PAGES[b].map((p) => `${b}:${p.key}`)),
    "plan:profile",
    "practice:portfolio",
  ]),
  "/ahead": new Set([
    ...DECISIONS.map((d) => `decide:${d.key}`),
    "coming:all",
    "goals:add",
    "goals:tradeoffs",
    "worth:today",
  ]),
};

type Suggestion = { id: string; topic: string; short: string; worthCents: number };

// A suggestion's own item, as its area's tree draws it while it's open.
function suggestionItems(root: AreaRoot, s: Suggestion): string[] {
  if (root === "/loans")
    return loansTree({
      asOf: "2026-10-17",
      debts: [],
      suggestions: [
        {
          key: s.id,
          topic: s.topic,
          short: s.short,
          worthCents: s.worthCents,
          worthKind: "save",
          urgency: "soon",
        },
      ],
      installments: 0,
      payoff: null,
      credit: null,
      review: null,
    }).tree.branches.flatMap((b) => b.items.map((i) => i.id));
  if (root === "/investments")
    return investingTree({
      suggestions: [
        {
          key: s.id,
          topic: s.topic,
          short: s.short,
          worthCents: s.worthCents,
          worthKind: "save",
          urgency: "soon",
        },
      ],
      accounts: [],
      totalCents: 0,
      byType: 0,
      cryptoCents: 0,
      profile: { complete: true, label: "Growth" },
      returns: { periods: 0 },
      months: false,
      practice: null,
    }).tree.branches.flatMap((b) => b.items.map((i) => i.id));
  return [];
}

// Why a link doesn't land, or null when it does.
function problem(href: string, s?: Suggestion): string | null {
  if (!href.startsWith("/")) return null;
  const [beforeHash, hash = ""] = href.split("#", 2);
  const [path, query = ""] = beforeHash.split("?", 2);
  if (!isPage(path)) return `no page at ${path}`;
  if (!isAreaRoot(path)) return null;
  if (hash && !(hash in (AREA_ANCHORS[path] ?? {})) && path !== "/insurance")
    return `old anchor #${hash}`;
  const focus = new URLSearchParams(query).get("focus");
  if (!focus) return null;
  const branch = focus.split(":")[0];
  if (!BRANCHES[path].includes(branch)) return `no branch "${branch}" on ${path}`;
  if (!focus.includes(":") || FIXED[path].has(focus)) return null;
  if (s && suggestionItems(path, s).includes(focus)) return null;
  return `no item "${focus}" on ${path}`;
}

describe("landing", () => {
  it("turns an old anchor into its node, and keeps everything else", () => {
    expect(landing("/taxes#withholding")).toBe("/taxes?focus=estimate:withholding");
    expect(landing("/investments#backtests-heading")).toBe(
      "/investments?focus=strategies:backtests",
    );
    expect(landing("/taxes?focus=soon#plan")).toBe("/taxes?focus=soon#plan");
    expect(landing("/taxes/profile#states")).toBe("/taxes/profile#states");
    expect(landing("/insurance?need=life#options")).toBe("/insurance?need=life#options");
    expect(landing("https://www.irs.gov")).toBe("https://www.irs.gov");
  });

  it("the check itself catches a link that lands nowhere", () => {
    expect(problem("/taxes?focus=nowhere")).toBe('no branch "nowhere" on /taxes');
    expect(problem("/taxes?focus=estimate:nothing")).toBe('no item "estimate:nothing" on /taxes');
    expect(problem("/taxes#nothing")).toBe("old anchor #nothing");
    expect(problem("/taxes/nothing")).toBe("no page at /taxes/nothing");
    expect(problem("/taxes?focus=estimate:withholding")).toBeNull();
  });

  it("opens a suggestion's own node when its button opens the area page", () => {
    const s = (topic: string) => ({ key: `x:${topic}`, topic });
    expect(landing("/loans", s("bnpl"))).toMatch(/^\/loans\?focus=[a-z]+:bnpl$/);
    expect(landing("/investments", s("idle_cash"))).toBe("/investments?focus=ideas:x:idle_cash");
    expect(landing("/insurance", s("card_cover"))).toBe("/insurance?focus=cards");
    expect(landing("/taxes", s("estimated_taxes"))).toBe("/taxes?focus=soon");
    // Without a node for it, the area page itself.
    expect(landing("/insurance", s("something_new"))).toBe("/insurance");
    expect(landing("/loans/refinance", s("refinance"))).toBe("/loans/refinance");
  });
});

describe("every link Jane gives lands on something", () => {
  it.each(PEOPLE.map((p) => [p.id, p] as const))(
    "%s: each suggestion's button and More links",
    (_, person) => {
      const bad: string[] = [];
      for (const s of reportFor(person).fired) {
        const own = landing(s.action.href, { key: s.id, topic: s.topic });
        const why = problem(own, s);
        if (why) bad.push(`${s.topic}: ${own}: ${why}`);
        for (const m of s.more ?? []) {
          const href = landing(m.href);
          const whyMore = problem(href);
          if (whyMore) bad.push(`${s.topic} (More): ${href}: ${whyMore}`);
        }
      }
      expect(bad).toEqual([]);
    },
  );

  it("every page link in the code", () => {
    // Not links: the question bank names the page a question is about, the menu lists path
    // prefixes, and the proxy has its own matcher syntax.
    const NOT_LINKS = /^(lib\/jane-agent\/checks\/|config\/navigation\.ts$|proxy\.ts$)/;
    const bad: string[] = [];
    let seen = 0;
    const LITERAL = /["'`](\/[a-z][a-z0-9-]*(?:\/[^"'`\s<>)]*)?(?:[?#][^"'`\s<>)]*)?)["'`]/g;
    for (const f of files(SRC)) {
      const where = relative(SRC, f);
      if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f) || NOT_LINKS.test(where)) continue;
      for (const [, raw] of readFileSync(f, "utf8").matchAll(LITERAL)) {
        const top = raw.split(/[/?#]/)[1];
        // A bare "/api/" is a prefix the code compares paths with, not a link.
        if (!TOP.has(top) || raw === "/api/") continue;
        if (raw.includes("${")) {
          // A template's own parts (${id}) can be anything: its path, with one segment for
          // each part, must still be a page.
          const path = raw
            .split(/[?#]/)[0]
            .replace(/\$\{[^}]*\}/g, "x")
            .replace(/\/$/, "");
          if (!path.includes("${") && !isPage(path))
            bad.push(`${where}: ${raw}: no page at ${path}`);
          continue;
        }
        seen += 1;
        const href = landing(raw);
        const why = problem(href);
        if (why) bad.push(`${where}: ${raw}: ${why}`);
      }
    }
    expect(bad).toEqual([]);
    // It read the code's links, not nothing.
    expect(seen).toBeGreaterThan(500);
  });
});
