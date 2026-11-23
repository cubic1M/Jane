import { afterAll, describe, expect, it, vi } from "vitest";

// Actions stuck in `running` (a crash mid-act) are listed for the team across people once they're
// CONNECTOR_STUCK_MINUTES old, and marked once, done or failed, on the audit log.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { CONNECTOR_STUCK_MINUTES } from "@/config/connectors";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { markStuck, stuckActions } from "./stuck";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: connector actions stuck in running", db);
const MINUTE = 60 * 1000;

describe.runIf(url)("connector actions stuck in running", () => {
  const people: string[] = [];
  afterAll(() => removePeople(db, people));

  async function action(userId: string, status: string) {
    const row = await system().connectorAction.create({
      data: {
        userId,
        connectorId: "sandbox_subscription_cancel",
        kind: "cancel_subscription",
        status,
        amountCents: 0,
        summary: "Cancel Netflix",
        steps: [],
        details: {},
        fingerprint: "f",
        idempotencyKey: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60 * MINUTE),
      },
      select: { id: true, updatedAt: true },
    });
    return row;
  }

  it("lists running actions past the limit, across people, and only those", async () => {
    const [a, b] = [await samplePerson(db), await samplePerson(db)];
    people.push(a, b);
    const one = await action(a, "running");
    const two = await action(b, "running");
    const done = await action(a, "succeeded");
    const later = new Date(one.updatedAt.getTime() + (CONNECTOR_STUCK_MINUTES + 1) * MINUTE);
    const ids = (await stuckActions({ now: later })).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([one.id, two.id]));
    expect(ids).not.toContain(done.id);
    const soon = new Date(one.updatedAt.getTime() + (CONNECTOR_STUCK_MINUTES - 1) * MINUTE);
    expect((await stuckActions({ now: soon })).map((s) => s.id)).not.toContain(one.id);
  });

  it("marks one once, with an audit row naming whose it was; never a fresh or finished one", async () => {
    const userId = await samplePerson(db);
    people.push(userId);
    const stuck = await action(userId, "running");
    const later = new Date(stuck.updatedAt.getTime() + (CONNECTOR_STUCK_MINUTES + 1) * MINUTE);

    expect(await markStuck(stuck.id, "failed", "admin_1", { now: stuck.updatedAt })).toBe(false);
    expect(await markStuck(stuck.id, "failed", "admin_1", { now: later })).toBe(true);
    expect(await markStuck(stuck.id, "succeeded", "admin_1", { now: later })).toBe(false);

    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(row).toMatchObject({ status: "failed", reason: "marked_by_team" });
    const audit = await system().auditLog.findMany({
      where: { targetId: stuck.id, event: "connector_action_marked" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: "admin", actorId: "admin_1" });
    expect(audit[0]?.metadata).toMatchObject({ outcome: "failed", user_id: userId });
  });
});
