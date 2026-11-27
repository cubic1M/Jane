import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withPersonLock } from "./person-lock";

// The same work for one person never runs twice at once, against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.runIf(url)("withPersonLock", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(() => client.$disconnect());

  it("leaves a person whose work is already running, and runs it again once it ends", async () => {
    const id = `lock-${crypto.randomUUID()}`;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = withPersonLock("t", id, async () => gate.then(() => "first"), { client });
    await pause(300);

    expect(await withPersonLock("t", id, async () => "second", { client })).toEqual({ ran: false });
    // Another person, and another kind of work, are not held.
    expect(await withPersonLock("t", `${id}-other`, async () => "x", { client })).toEqual({
      ran: true,
      value: "x",
    });
    expect(await withPersonLock("u", id, async () => "y", { client })).toEqual({
      ran: true,
      value: "y",
    });

    release();
    expect(await first).toEqual({ ran: true, value: "first" });
    expect(await withPersonLock("t", id, async () => "third", { client })).toEqual({
      ran: true,
      value: "third",
    });
  });

  it("queues a waiting caller behind the holder instead of overlapping it", async () => {
    const id = `lock-${crypto.randomUUID()}`;
    const order: string[] = [];
    const a = withPersonLock(
      "t",
      id,
      async () => {
        order.push("a start");
        await pause(400);
        order.push("a end");
      },
      { client, wait: true },
    );
    await pause(100);
    const b = withPersonLock("t", id, async () => void order.push("b"), { client, wait: true });
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "a end", "b"]);
  });

  it("gives the lock back when the work throws", async () => {
    const id = `lock-${crypto.randomUUID()}`;
    await expect(
      withPersonLock("t", id, async () => Promise.reject(new Error("boom")), { client }),
    ).rejects.toThrow("boom");
    expect(await withPersonLock("t", id, async () => 1, { client })).toEqual({
      ran: true,
      value: 1,
    });
  });
});
