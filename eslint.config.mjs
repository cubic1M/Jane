import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import rawDbAllowlist from "./src/config/raw-db-allowlist.json" with { type: "json" };
import janeRules from "./src/security/lint/no-raw-db.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // A name starting with "_" is unused on purpose (a parameter a signature needs, a value
    // left out of a destructure).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // New raw database client uses fail; what was there when the rule came in is listed, and the
    // list only shrinks (docs/security/access-proof.md). Tests and the two files that build the
    // client aren't app code reaching for it.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "src/lib/db.ts",
      "src/lib/rls-pg.ts",
      "src/test-setup/**",
      "src/security/access-proof/**",
    ],
    plugins: { jane: janeRules },
    rules: { "jane/no-raw-db": ["error", { allowed: rawDbAllowlist }] },
  },
  {
    // A sleep passes on a fast runner and fails on a slow one: e2e/waits.ts has what to use.
    files: ["e2e/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "waitForTimeout",
          message: "Wait for something real: see e2e/waits.ts.",
        },
      ],
    },
  },
  {
    // Logs leave the app as they are, so app code writes through src/lib/log.ts, which cleans them.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test-setup/**", "src/lib/log.ts"],
    rules: { "no-console": "error" },
  },
  globalIgnores([
    ".next/**",
    ".semgrep/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
