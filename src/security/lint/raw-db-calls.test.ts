import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Deny by default (docs/security/rls.md), checked with the type checker rather than by name: no code
// reads a table, or runs raw SQL, on a raw Prisma client, whatever the variable is called and however
// it arrived. A person's data goes through scopedFor or personTransaction, and the system's through
// systemDb or systemTransaction, whose types carry a brand this looks for. The login role in
// production can't use a table itself, so a call this misses fails there; the whole test suite runs
// on that login too (src/test-setup/no-bypass.ts).

// What may touch the raw client: the doors, and what builds them.
const DOORS = /^src\/lib\/(db|db-scoped|system-db|rls|rls-coverage|read-cache)\.ts$/;
const NOT_APP_CODE =
  /\.test\.tsx?$|\.d\.ts$|^src\/generated\/|^src\/test-setup\/|^src\/security\/access-proof\//;

const isBranded = (t: ts.Type): boolean =>
  !!t.getProperty("__system") ||
  !!t.getProperty("__person") ||
  (t.isIntersection() && t.types.some(isBranded));

function isRawClient(t: ts.Type): boolean {
  if (isBranded(t)) return false;
  if (t.isUnion()) return t.types.some(isRawClient);
  const name = t.getSymbol()?.getName();
  return name === "PrismaClient" || t.aliasSymbol?.getName() === "TransactionClient";
}

// What a raw client hands out, whatever its type was narrowed to (Pick<PrismaClient, ...>, a type
// of its own with $queryRaw): a table's delegate, or a raw query.
const RAW_METHODS = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);
function handsOutRaw(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  c: ts.TypeChecker,
) {
  const on = c.getTypeAtLocation(node.expression);
  if (isBranded(on)) return false;
  if (ts.isPropertyAccessExpression(node) && RAW_METHODS.has(node.name.text)) return true;
  return /Delegate$/.test(c.getTypeAtLocation(node).getSymbol()?.getName() ?? "");
}

// Passing the client along is fine, it can do nothing by itself. Reading a table or a method off it
// isn't: `client.user`, `tx.$queryRaw`, `client["user"]`.
function rawReads(program: ts.Program, files: readonly string[]): string[] {
  const checker = program.getTypeChecker();
  const found: string[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const visit = (node: ts.Node) => {
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        (isRawClient(checker.getTypeAtLocation(node.expression)) || handsOutRaw(node, checker))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        const text = node.getText().replace(/\s+/g, " ").slice(0, 60);
        found.push(`${path.relative(process.cwd(), file)}:${line + 1} ${text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

const SAMPLE = path.resolve("src/lib/__raw_db_sample__.ts");
const SAMPLE_CODE = `
  import type { Prisma, PrismaClient } from "@/generated/prisma/client";
  import { db } from "@/lib/db";
  import { personTransaction } from "@/lib/db-scoped";
  import { systemDb, systemTransaction } from "@/lib/system-db";
  export const direct = db.user.findMany();
  export const passed = (client: PrismaClient) => client.account.count();
  export const inTx = (tx: Prisma.TransactionClient) => tx.$queryRaw\`SELECT 1\`;
  type OnlyRaw = Pick<PrismaClient, "$queryRaw">;
  export const narrowed = (c: OnlyRaw) => c.$queryRaw\`SELECT 1\`;
  export const picked = (c: Pick<PrismaClient, "job">) => c.job.count();
  export const indexed = (client: PrismaClient) => client["user"].count();
  export const allowed = [
    systemDb("a reason", db).user.count(),
    systemTransaction("a reason", (tx) => tx.user.count()),
    personTransaction("id", (tx) => tx.account.count()),
  ];
`;

describe("raw database calls", () => {
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile("tsconfig.json", ts.sys.readFile).config,
    ts.sys,
    process.cwd(),
  );
  const options = { ...config.options, noEmit: true, incremental: false };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (f) => f === SAMPLE || fileExists(f);
  host.readFile = (f) => (f === SAMPLE ? SAMPLE_CODE : readFile(f));
  host.getSourceFile = (f, language, ...rest) =>
    f === SAMPLE
      ? ts.createSourceFile(f, SAMPLE_CODE, language, true)
      : getSourceFile(f, language, ...rest);
  const program = ts.createProgram([...config.fileNames, SAMPLE], options, host);

  it("are all behind a door", () => {
    const appCode = config.fileNames.filter((f) => {
      const name = path.relative(process.cwd(), f);
      return name.startsWith("src/") && !NOT_APP_CODE.test(name) && !DOORS.test(name);
    });
    expect(appCode.length).toBeGreaterThan(500);
    expect(rawReads(program, appCode)).toEqual([]);
  });

  it("are found however the client got there, and the doors aren't mistaken for one", () => {
    const reads = rawReads(program, [SAMPLE]).map((r) => r.split(" ")[1]);
    expect(reads).toEqual([
      "db.user",
      "client.account",
      "tx.$queryRaw",
      "c.$queryRaw",
      "c.job",
      'client["user"]',
    ]);
  });
});
