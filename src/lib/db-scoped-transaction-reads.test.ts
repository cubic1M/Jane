import { beforeEach, describe, expect, it, vi } from "vitest";

// A server render keeps one store of shared reads for its length; here it lasts for a test.
let store: unknown;
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache:
    <T>(make: () => T) =>
    () =>
      (store ??= make()) as T,
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "./db-scoped";

type Hook = (call: {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

// A client whose findings come from `answer`, through whatever hook scopedFor put on it.
function findingsFrom(answer: () => string) {
  const query = vi.fn(async () => [{ id: answer() }]);
  const raw = async () => [];
  const client = {
    $executeRaw: raw,
    $executeRawUnsafe: raw,
    $queryRaw: raw,
    $queryRawUnsafe: raw,
    // A list of statements, as a scoped query sends outside a transaction.
    $transaction: async (statements: Promise<unknown>[]) => Promise.all(statements),
    // As Prisma does: an extended client's transaction hands its callback the same extensions.
    $extends: (extension: { query: { $allModels: { $allOperations: Hook } } }) => {
      const hook = extension.query.$allModels.$allOperations;
      const extended: Record<string, unknown> = {
        ...client,
        user: {},
        finding: {
          findMany: (args?: unknown) =>
            hook({ model: "Finding", operation: "findMany", args, query }),
        },
      };
      extended.$transaction = async (work: unknown) =>
        Array.isArray(work) ? Promise.all(work) : (work as (tx: unknown) => unknown)(extended);
      return extended;
    },
  };
  return { scoped: scopedFor("u1", client as unknown as PrismaClient), query };
}

beforeEach(() => {
  store = undefined;
});

// A transaction's reads see its own uncommitted rows, and are there to see the rows as they are
// now: neither side may hand its answer to the other.
describe("reads inside a transaction and the render's shared reads", () => {
  it("never hands a row the transaction rolled back to a read outside it", async () => {
    let row = "not committed";
    const { scoped, query } = findingsFrom(() => row);
    let outside: Promise<unknown> | undefined;
    await expect(
      scoped.transaction(async (tx) => {
        await tx.findings.findMany();
        row = "as stored";
        outside = scoped.findings.findMany();
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(await outside).toEqual([{ id: "as stored" }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("asks the database inside a transaction, whatever the render read earlier", async () => {
    let row = "before";
    const { scoped } = findingsFrom(() => row);
    expect(await scoped.findings.findMany()).toEqual([{ id: "before" }]);
    row = "changed since";
    const inside = await scoped.transaction((tx) => tx.findings.findMany());
    expect(inside).toEqual([{ id: "changed since" }]);
  });
});
