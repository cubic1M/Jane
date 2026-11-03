import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.mts";

// The tests Stryker runs against each mutant: the money folders' own, those needing no database.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        "src/detection/**/*.test.ts",
        "src/data-sources/csv/*.test.ts",
        "src/data-sources/ofx/*.test.ts",
        "src/data-sources/dedupe*.test.ts",
        "src/categorize/**/*.test.ts",
        "src/lib/money*.test.ts",
        "src/lib/import/*.test.ts",
      ],
      exclude: ["**/*.integration.test.ts", "**/*.cli.test.ts", "**/node_modules/**"],
    },
  }),
);
