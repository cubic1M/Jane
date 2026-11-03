// The layers that matter, and only those: a rule here stops a real mistake (npm run check:layers).
// A new exception goes in `pathNot` with a reason; there's no list of known breaks to hide in.

const TESTS = "(\\.test\\.tsx?$|/__fixtures__/|^src/test-setup/|^src/accuracy/)";

module.exports = {
  forbidden: [
    {
      name: "only-pages-import-pages",
      comment:
        "src/app is the top: library code can't depend on a page. Components may import a page's server actions.",
      severity: "error",
      from: { path: "^src/", pathNot: ["^src/(app|components)/", TESTS] },
      to: { path: "^src/app/" },
    },
    {
      name: "readers-have-no-database",
      comment:
        "Reading a statement and the rules that judge rows are pure: they're given rows, so tests and the accuracy bench run them with no database.",
      severity: "error",
      from: { path: "^src/(data-sources/(csv|ofx)|detection/rules)/", pathNot: TESTS },
      to: {
        path: "^src/lib/db(-scoped)?\\.ts$",
      },
    },
    {
      name: "config-is-a-leaf",
      comment: "Thresholds and rates are data: they can't depend on what uses them.",
      severity: "error",
      from: { path: "^src/config/", pathNot: TESTS },
      to: {
        path: "^src/(app|components|detection|detectors|insights|planning|profile|categorize)/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "pages-and-rules-never-call-claude",
      comment:
        "Pages go through src/lib; rules, thresholds and simulated money make no Claude call at all.",
      severity: "error",
      from: {
        path: "^src/(app|components|config|data-sources|detection|insights|planning|detectors|lib/paper|lib/events)/",
        pathNot: TESTS,
      },
      to: { path: "node_modules/@anthropic-ai/sdk", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "plaid-sdk-stays-in-its-corner",
      comment: "Access tokens never leave the Plaid code.",
      severity: "error",
      from: { path: "^src/", pathNot: ["^src/data-sources/plaid/", "^src/lib/plaid", TESTS] },
      to: { path: "node_modules/plaid/", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "paper-money-touches-nothing-real",
      comment:
        "The paper account and the events overlay are simulated money: no bank, Plaid or real-money module.",
      severity: "error",
      from: { path: "^src/lib/(paper|events)/", pathNot: TESTS },
      to: {
        path: "^src/(data-sources/plaid/|lib/plaid|lib/money-movement|lib/brokerage/)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-test-code-in-production",
      severity: "error",
      from: { path: "^src/", pathNot: TESTS },
      to: { path: TESTS },
    },
    {
      name: "statement-readers-and-rules-have-no-cycles",
      comment: "A cycle in these makes load order decide what a number is.",
      severity: "error",
      from: {
        path: "^src/(detection/rules|data-sources/(csv|ofx|plaid)|categorize)/",
        pathNot: TESTS,
      },
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^src/generated/" },
  },
};
