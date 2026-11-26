import parser from "@typescript-eslint/parser";
import { Linter, type Rule } from "eslint";
import { describe, expect, it } from "vitest";
import { noRawDb } from "./no-raw-db.mjs";

const lint = (code: string) =>
  new Linter().verify(
    code,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: parser as Linter.Parser },
        plugins: { jane: { rules: { "no-raw-db": noRawDb as unknown as Rule.RuleModule } } },
        rules: { "jane/no-raw-db": ["error", { allowed: {} }] },
      },
    ],
    { filename: "src/lib/x.ts" },
  );
const messages = (code: string) => lint(code).map((m) => m.message);

describe("no-raw-db, the ways round it", () => {
  it.each(['export { Pool } from "pg";', 'export * from "@prisma/adapter-pg";'])(
    "passing the driver on: %s",
    (code) => {
      expect(messages(code)[0]).toContain("talk to the database driver");
    },
  );

  it("but not types passed on by name", () => {
    expect(messages('export { type PoolConfig } from "pg";')).toEqual([]);
  });

  it("a name given the client by assignment", () => {
    const code = `import { db } from "@/lib/db";
      let raw; raw = db; export const a = raw.user.count();`;
    expect(messages(code)[0]).toContain("(1 here, 0 listed)");
  });

  it("a table taken out of the client by destructuring", () => {
    const code = `import { db } from "@/lib/db";
      const { $queryRaw: query, user } = db; export const a = [query, user.count()];`;
    expect(messages(code)[0]).toContain("(2 here, 0 listed)");
  });

  it.each(["systemDb(` `);", "const WHY = ``; systemDb(WHY);"])("an empty reason: %s", (code) => {
    expect(messages(code)[0]).toContain("in words");
  });
});
