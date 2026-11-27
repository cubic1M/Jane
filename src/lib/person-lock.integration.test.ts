import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { withPersonLock } from "./person-lock";

// The same work for one person never runs twice at once, against a real, migrated Postgres. The
// holder says when it has the lock (never a fixed delay), and is let go in a finally.
const url = process.env.TEST_DATABASE_URL;

function holder() {
  let ready: () => void = () => {};
  let release: () => void = () => {};
  return {
    held: new Promise<void>((resolve) => (ready = resolve)),
    gate: new Promise<void>((resolve) => (release = resolve)),
    ready: () => ready(),
    release: () => release(),
  };
}

describe.runIf(url)("withPersonLock", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(() => client.$disconnect());

  it("leaves a person whose work is already running, and runs it again once it ends", async () => {
    const id = `lock-${crypto.randomUUID()}`;
    const h = holder();
    const first = withPersonLock(
      "t",
      id,
      async () => {
        h.ready();
        await h.gate;
        return "first";
      },
      { client },
    );
    try {
      await h.held;
      expect(await withPersonLock("t", id, async () => "second", { client })).toEqual({
        ran: false,
      });
      // Another person, and another kind of work, are not held.
      expect(await withPersonLock("t", `${id}-other`, async () => "x", { client })).toEqual({
        ran: true,
        value: "x",
      });
      expect(await withPersonLock("u", id, async () => "y", { client })).toEqual({
        ran: true,
        value: "y",
      });
    } finally {
      h.release();
    }
    expect(await first).toEqual({ ran: true, value: "first" });
    expect(await withPersonLock("t", id, async () => "third", { client })).toEqual({
      ran: true,
      value: "third",
    });
  });

  it("queues a waiting caller behind the holder instead of overlapping it", async () => {
    const id = `lock-${crypto.randomUUID()}`;
    const order: string[] = [];
    const h = holder();
    const a = withPersonLock(
      "t",
      id,
      async () => {
        order.push("a start");
        h.ready();
        await h.gate;
        order.push("a end");
      },
      { client, wait: true },
    );
    let b: Promise<unknown> = Promise.resolve();
    try {
      await h.held;
      b = withPersonLock("t", id, async () => void order.push("b"), { client, wait: true });
      // b has asked and must still be waiting: it cannot have run while a holds the lock.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(order).toEqual(["a start"]);
    } finally {
      h.release();
    }
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
