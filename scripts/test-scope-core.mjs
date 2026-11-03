// How much a PR's unit tests run (docs/ci.md). The whole suite costs about 50 runner-minutes a push and
// main runs it anyway, so a PR runs what its diff can reach (vitest --changed), unless the diff touches
// something that graph can't see or that's too costly to miss. Pure.

// Vitest's graph follows imports, so it can't see these. The rest are too costly to find out about
// only after they've turned main red, since a red main stops every deploy.
const FULL_RUN_PATHS = [
  /^package(-lock)?\.json$/,
  /^prisma\//,
  /^prisma\.config\.ts$/,
  /^(vitest|next|eslint|playwright)\.config\./,
  /^tsconfig/,
  /^\.nvmrc$/,
  /^\.env/,
  /^vercel\.json$/,
  /^\.github\//,
  /^scripts\//,
  /^src\/test-setup\//,
  /^src\/config\//,
  /^src\/generated\//,
  /^src\/env\b/,
  /^src\/lib\/db/,
  /^src\/lib\/rls/,
  /^src\/security\//,
  /^src\/lib\/guardrails/,
  /^src\/lib\/advice-mode/,
  /^src\/lib\/session/,
  /^src\/lib\/mfa/,
  /^src\/auth/,
  /^src\/app\/\(auth\)\//,
  /^src\/app\/api\/auth\//,
  /^src\/proxy\./,
  /^src\/middleware\./,
  /^src\/lib\/import\//,
  /^src\/app\/import\//,
];

// Forces the whole suite on a PR; "e2e" asks for everything already.
export const FULL_RUN_LABELS = ["full-tests", "e2e"];

// A run of this many integration files takes this many shards: they're 94% of the suite's time.
const SHARDS_FOR_INTEGRATION_FILES = [
  { atMost: 15, shards: 1 },
  { atMost: 60, shards: 2 },
];
const ALL_SHARDS = 4;

// Run on main but not on PRs: 11% of the whole suite's time in one file (8 sample people, about 80
// seconds each), checking merges a PR's own tests cover.
export const MAIN_ONLY_TESTS = ["src/lib/consolidation-qa.integration.test.ts"];

const isDoc = (path) => path.endsWith(".md");

// "docs" | "changed" | "full". Tests read many docs and compare them, so a doc a test names isn't
// docs-only. An empty diff is "full": something odd is going on, and a skip would hide it.
export function testScope({ changedPaths, event, onMain, labels = [], docsReadByTests = [] }) {
  if (onMain || event !== "pull_request") return { mode: "full", why: "not a pull request" };
  const label = labels.find((l) => FULL_RUN_LABELS.includes(l));
  if (label) return { mode: "full", why: `label ${label}` };
  if (changedPaths.length === 0) return { mode: "full", why: "no changed files seen" };
  const trigger = changedPaths.find((path) => FULL_RUN_PATHS.some((p) => p.test(path)));
  if (trigger) return { mode: "full", why: trigger };
  const docsOnly = changedPaths.every((path) => isDoc(path) && !docsReadByTests.includes(path));
  if (docsOnly) return { mode: "docs", why: "only docs no test reads" };
  return { mode: "changed", why: "reachable from the diff" };
}

export function shardsFor(mode, integrationFiles) {
  if (mode === "docs") return 0;
  if (mode === "full") return ALL_SHARDS;
  return (
    SHARDS_FOR_INTEGRATION_FILES.find(({ atMost }) => integrationFiles <= atMost)?.shards ??
    ALL_SHARDS
  );
}

export const docsNamedIn = (text) => text.match(/\bdocs\/[\w./-]+\.md\b/g) ?? [];

// What the unit jobs add to `vitest run`. Only a PR with no full-run label leaves anything out.
export function vitestArgs(mode, { event, labels = [] }) {
  const args = mode === "changed" ? ["--changed=HEAD^1", "--passWithNoTests"] : [];
  const forced = labels.some((label) => FULL_RUN_LABELS.includes(label));
  if (event === "pull_request" && !forced) {
    for (const test of MAIN_ONLY_TESTS) args.push("--exclude", test);
  }
  return args.join(" ");
}

// A PR runs the end-to-end spec files it changes, on top of the critical tests: rewriting a spec
// and first running it on main would turn main red.
export const changedSpecs = (changedPaths) =>
  changedPaths.filter((path) => /^e2e\/[\w./-]+\.spec\.ts$/.test(path));
