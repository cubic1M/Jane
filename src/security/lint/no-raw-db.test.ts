import { existsSync, readFileSync } from "node:fs";
import parser from "@typescript-eslint/parser";
import { Linter, type Rule } from "eslint";
import { describe, expect, it } from "vitest";
import allowlist from "@/config/raw-db-allowlist.json";
import { noRawDb } from "./no-raw-db.mjs";

const lint = (code: string, allowed: Record<string, number> = {}, filename = "src/lib/x.ts") =>
  new Linter().verify(
    code,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: parser as Linter.Parser },
        plugins: { jane: { rules: { "no-raw-db": noRawDb as unknown as Rule.RuleModule } } },
        rules: { "jane/no-raw-db": ["error", { allowed }] },
      },
    ],
    { filename },
  );

describe("no-raw-db", () => {
  it("fails a direct use in a file that isn't listed", () => {
    const [problem] = lint(`import { db } from "@/lib/db"; export const a = db.user.findMany();`);
    expect(problem.message).toContain("New raw database client use (1 here, 0 listed)");
  });

  it("counts a use through a default parameter and through the name it is given", () => {
    const code = `import { db as defaultClient } from "@/lib/db";
      export function f({ client = defaultClient } = {}) { client.a.findMany(); return client.b.count(); }`;
    expect(lint(code, { "src/lib/x.ts": 3 })).toEqual([]);
    expect(lint(code, { "src/lib/x.ts": 2 })[0].message).toContain("3 here, 2 listed");
  });

  it("counts `const raw = db`, a plain default parameter, and passing it on", () => {
    const code = `import { db } from "@/lib/db";
      const raw = db;
      export const a = raw.user.count();
      export function g(client = db) { return client.x.count(); }
      export const h = helper(db);`;
    expect(lint(code, { "src/lib/x.ts": 5 })).toEqual([]);
  });

  it("asks for the number to come down when a file uses it less", () => {
    const [problem] = lint(`import { db } from "@/lib/db"; export const a = db;`, {
      "src/lib/x.ts": 4,
    });
    expect(problem.message).toContain("lower its number");
  });

  it("isn't fooled by a local name or a type", () => {
    expect(
      lint(`import type { db } from "@/lib/db";
        import { scopedFor } from "@/lib/db-scoped";
        import type { PrismaClient } from "@/generated/prisma/client";
        export function f(id: string, c: PrismaClient) { const db = scopedFor(id, c); return db.accounts.findMany(); }`),
    ).toEqual([]);
  });

  it("catches the other ways to the client: re-exports, dynamic imports, relative paths", () => {
    expect(lint(`export { db } from "@/lib/db";`)[0].message).toContain("New raw");
    expect(lint(`export const m = import("@/lib/db");`)[0].message).toContain("New raw");
    expect(lint(`import { db } from "./db"; export const a = db;`)[0].message).toContain("New raw");
    expect(lint(`import { db } from "../lib/db"; export const a = db;`)[0].message).toContain(
      "New raw",
    );
  });

  it("stops a second client or a driver", () => {
    expect(lint(`import pg from "pg"; export const p = new pg.Pool();`)[0].message).toContain(
      "database driver",
    );
    expect(
      lint(
        `import { PrismaClient } from "@/generated/prisma/client"; export const c = new PrismaClient({});`,
      )[0].message,
    ).toContain("database driver");
  });
});

describe("the raw client allowlist", () => {
  it("names only files that exist", () => {
    const gone = Object.keys(allowlist).filter((file) => !existsSync(file));
    expect(gone).toEqual([]);
  });

  it("stays sorted, so two pull requests rarely touch the same line", () => {
    const files = Object.keys(allowlist);
    expect(files).toEqual([...files].sort());
  });

  it("is on in the lint config, and nothing turns it off", () => {
    expect(readFileSync("eslint.config.mjs", "utf8")).toMatch(/jane\/no-raw-db/);
  });
});
