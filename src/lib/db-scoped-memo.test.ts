import { beforeEach, describe, expect, it, vi } from "vitest";

// A server render keeps one store for its length; here the store lasts for a test.
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

// The scoped client's one hook, taken from the $extends call, with a counted query behind it.
function hookFor(userId: string) {
  let hook!: Hook;
  const client = {
    $extends: (extension: { query: { $allModels: { $allOperations: Hook } } }) => {
      hook = extension.query.$allModels.$allOperations;
      return {};
    },
  } as unknown as PrismaClient;
  scopedFor(userId, client);
  const rows = [{ id: "a1", balance: 100 }];
  const query = vi.fn(async () => rows);
  const run = (operation: string, args?: unknown, model = "Account") =>
    hook({ model, operation, args, query });
  return { run, query };
}

beforeEach(() => {
  store = undefined;
});

describe("the scoped client's shared reads", () => {
  it("asks the database once for the same read, however many parts of a page make it", async () => {
    const { run, query } = hookFor("u1");
    await Promise.all([
      run("findMany", { select: { id: true } }),
      run("findMany", { select: { id: true } }),
    ]);
    await run("findMany", { select: { id: true } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("asks again when the question differs", async () => {
    const { run, query } = hookFor("u1");
    await run("findMany", { select: { id: true } });
    await run("findMany", { select: { balance: true } });
    await run("count");
    await run("findMany", { select: { id: true } }, "Transaction");
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("never mixes users: each question is scoped to its own user", async () => {
    const mine = hookFor("u1");
    const theirs = hookFor("u2");
    await mine.run("findMany");
    await theirs.run("findMany");
    expect(mine.query).toHaveBeenCalledTimes(1);
    expect(theirs.query).toHaveBeenCalledTimes(1);
    // Each query carries its own user's id.
    expect(mine.query).toHaveBeenCalledWith({ where: { AND: [{ userId: "u1" }] } });
    expect(theirs.query).toHaveBeenCalledWith({ where: { AND: [{ userId: "u2" }] } });
  });

  it("forgets what it read when a write goes through, before and after it", async () => {
    const { run, query } = hookFor("u1");
    await run("findMany");
    await run("update", { where: { id: "a1" }, data: { balance: 1 } });
    await run("findMany");
    expect(query).toHaveBeenCalledTimes(3);
    await run("findMany");
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("gives each reader its own copy of the rows", async () => {
    const { run } = hookFor("u1");
    const first = (await run("findMany")) as { balance: number }[];
    first[0].balance = 0;
    const second = (await run("findMany")) as { balance: number }[];
    expect(second[0].balance).toBe(100);
  });
});
