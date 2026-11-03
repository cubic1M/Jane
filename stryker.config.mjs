// The weak-test finder: changes the money code on purpose and asks whether any test notices. A
// change no test notices is a place a real bug could hide. Money folders only, never the whole
// repo, and there's no score to reach (.github/workflows/mutation.yml; docs/money-rules.md).
const config = {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.stryker.config.mts" },
  mutate: [
    "src/detection/**/*.ts",
    "src/data-sources/csv/{control-totals,csv-source,formats,column-mapping,dates}.ts",
    "src/data-sources/ofx/parse-ofx.ts",
    "src/data-sources/dedupe.ts",
    "src/lib/money.ts",
    "src/lib/import/{balances,corrections,cross-format}.ts",
    "!**/*.test.ts",
    "!**/__fixtures__/**",
  ],
  // Words shown to people change without a test noticing, and that isn't a money bug.
  mutator: { excludedMutations: ["StringLiteral"] },
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "reports/mutation/incremental.json",
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  concurrency: Number(process.env.STRYKER_WORKERS ?? 2),
  timeoutMS: 30_000,
  // A static value is checked by running every test: slow, and little to learn.
  ignoreStatic: true,
  dryRunTimeoutMinutes: 30,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
};

export default config;
