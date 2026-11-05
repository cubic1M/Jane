import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tierOfChanges } from "../../.github/scripts/gates/tiers.mjs";

const change = (file: string, status = "M") => ({ status, file });
const tierOf = (file: string, status = "M", sql: string | null = "") =>
  tierOfChanges([change(file, status)], () => sql).tier;

describe("which tier a file is", () => {
  it.each([
    "src/components/card.tsx",
    "src/app/dashboard/page.tsx",
    "src/lib/rules.test.ts",
    "docs/gates.md",
    "e2e/home.spec.ts",
    // Close to a held name, and not it.
    "src/app/terms-of-trade/page.tsx",
    "src/lib/termsheet.ts",
    "src/lib/dbx.ts",
  ])("%s is A", (file) => {
    expect(tierOf(file)).toBe("A");
  });

  it.each([
    "src/auth.ts",
    "src/proxy.ts",
    "src/lib/auth-gate.ts",
    "src/lib/crypto.ts",
    "src/lib/crypto/source.ts",
    "src/lib/db.ts",
    "src/lib/db-scoped.ts",
    "src/lib/system-db.ts",
    "src/lib/rls.ts",
    "src/lib/guardrails.ts",
    "src/lib/plaid/sync.ts",
    "src/data-sources/plaid/plaid-source.ts",
    "src/app/api/plaid/webhook/route.ts",
    "src/security/lint/raw-db-calls.test.ts",
    "src/config/access-map.ts",
    "src/config/deny-by-default.ts",
    "prisma/schema.prisma",
    "CLAUDE.md",
    "eslint.config.mjs",
  ])("%s is B", (file) => {
    expect(tierOf(file)).toBe("B");
  });

  it.each([
    ".github/workflows/ci.yml",
    ".github/workflows/some-new-one.yml",
    ".github/dependabot.yml",
    ".github/scripts/gates/core.mjs",
    ".claude/settings.json",
    ".mcp.json",
    "src/lib/advice-mode.ts",
    "src/config/advice.ts",
    "src/config/money-movement.ts",
    "src/config/concierge.ts",
    "src/app/terms/page.tsx",
    "src/app/terms/accept/actions.ts",
    "src/app/privacy/page.tsx",
    "src/lib/terms.ts",
    "src/components/terms-tick.tsx",
    "src/accuracy/accuracy.test.ts",
    "vitest.config.mts",
    // A Mac's disk finds these at the real paths.
    "SRC/LIB/ADVICE-MODE.ts",
    ".GITHUB/workflows/ci.yml",
  ])("%s is C", (file) => {
    expect(tierOf(file)).toBe("C");
  });

  // A rename would otherwise drop a file out of its tier without anyone noticing.
  it.each([
    "src/auth.ts",
    "src/proxy.ts",
    "src/lib/crypto.ts",
    "src/lib/db.ts",
    "src/lib/plaid",
    "src/data-sources/plaid",
    "src/app/api/plaid",
    "src/config/money-movement.ts",
    "src/config/concierge.ts",
    "src/app/terms",
    "src/app/privacy",
    "src/lib/terms.ts",
    "src/components/terms-tick.tsx",
    "prisma/schema.prisma",
  ])("%s is still where the tiers look for it", (path) => {
    expect(existsSync(path)).toBe(true);
  });
});

describe("a migration's tier", () => {
  const file = "prisma/migrations/20261103_x/migration.sql";

  it("is B when it only adds", () => {
    expect(tierOf(file, "A", 'ALTER TABLE "x" ADD COLUMN "y" TEXT;')).toBe("B");
  });

  it.each([
    'DROP TABLE "x";',
    'ALTER TABLE "x" DROP COLUMN "y";',
    'DELETE FROM "x";',
    'TRUNCATE "x";',
    'ALTER TABLE "x" RENAME COLUMN "y" TO "z";',
    'UPDATE "x" SET "y" = 1;',
    'update "x" as a\nset "y" = 1;',
  ])("is C for %s", (sql) => {
    expect(tierOf(file, "A", sql)).toBe("C");
  });

  it("is C when it can't be read", () => {
    expect(tierOf(file, "A", null)).toBe("C");
  });

  it.each(["M", "D"])("is C when one that exists changes (%s)", (status) => {
    expect(tierOf(file, status, 'ALTER TABLE "x" ADD COLUMN "y" TEXT;')).toBe("C");
  });

  it("doesn't read a comment as a drop", () => {
    expect(tierOf(file, "A", '-- DROP TABLE "x";\nALTER TABLE "x" ADD COLUMN "y" TEXT;')).toBe("B");
  });
});

describe("a PR's tier", () => {
  it("is the highest of its files, and names the files that set it", () => {
    const result = tierOfChanges(
      [change("src/components/a.tsx"), change("src/lib/db.ts"), change("src/lib/advice-mode.ts")],
      () => "",
    );
    expect(result.tier).toBe("C");
    expect(result.files.map((f: { file: string }) => f.file)).toEqual(["src/lib/advice-mode.ts"]);
  });

  it("counts the old name of a file moved out of a held path", () => {
    const moved = { status: "R", from: "src/lib/advice-mode.ts", file: "src/lib/plain.ts" };
    expect(tierOfChanges([moved], () => "").tier).toBe("C");
  });

  it("is A for nothing changed", () => {
    expect(tierOfChanges([], () => "").tier).toBe("A");
  });
});
