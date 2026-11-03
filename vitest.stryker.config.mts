import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

// The tests Stryker runs against each mutant: the money folders' own, those needing no database.
// Spread, not mergeConfig: that adds these lists to the base's, so every test in the repo ran.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "src/detection/**/*.test.ts",
      "src/data-sources/csv/*.test.ts",
      "src/data-sources/ofx/*.test.ts",
      "src/data-sources/dedupe*.test.ts",
      "src/lib/money*.test.ts",
      "src/lib/import/*.test.ts",
    ],
    exclude: ["**/*.integration.test.ts", "**/*.cli.test.ts", "**/node_modules/**"],
  },
});
