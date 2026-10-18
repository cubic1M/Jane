import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// The real logAudit, writing to the test database.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { SYSTEM_ACTOR, logAudit } from "./audit";
import { NOT_ON_TEAM, changeActionStatus, getActionForAdmin, listQueue } from "./concierge";
import { exportUserData } from "./data-export";
import { AGENT, TEAM, UNDONE_WHY } from "./team-access";
import { teamAccessFor } from "./team-access-loader";

// Who saw my data (spec step 74), against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts), checked against the audit events themselves.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("team access against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  const adminEmail = `teammate-${suffix}@example.com`;
  // This file's actions start on their own list, so its queue views name no one from the
  // other test files running alongside.
  const queueOf = `queue-${suffix}@example.com`;
  const ONLY_OURS = () => ({ type: null, status: null, assignee: queueOf });
  let admin: { id: string; email: string };
  let a: string;
  let b: string;
  const notify = vi.fn();
  const actionIds: string[] = [];

  async function person(name: string) {
    return (await client.user.create({ data: { email: `${name}-${suffix}@example.com` } })).id;
  }

  async function action(userId: string, title: string) {
    const finding = await client.finding.create({
      data: {
        userId,
        type: "bank_fees",
        key: `${title}-${crypto.randomUUID()}`,
        title,
        confidence: "high",
        evidence: { merchant: `${title} Co` },
      },
    });
    const decision = await client.decision.create({
      data: { userId, findingId: finding.id, choice: "yes", cardSnapshot: { title } },
    });
    const { id } = await client.action.create({
      data: { userId, decisionId: decision.id, type: "recover_bank_fees", assignee: queueOf },
    });
    actionIds.push(id);
    return id;
  }

  // Every audit row about the person's data written by the team or the agent: what the
  // page must account for.
  const teamRowsAbout = (userId: string, actionIds: string[]) =>
    client.auditLog.findMany({
      where: {
        actorType: { in: ["admin", "system"] },
        OR: [
          { targetType: "user", targetId: userId },
          { targetType: "action", targetId: { in: actionIds } },
        ],
      },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const row = await client.user.create({ data: { email: adminEmail, role: "admin" } });
    admin = { id: row.id, email: adminEmail };
    a = await person("alex");
    b = await person("blair");
  });

  afterAll(async () => {
    const ids = [admin.id, a, b, ...actionIds];
    await client.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] },
    });
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it("shows each person only their own team and agent entries, by role", async () => {
    const actionA = await action(a, `Alex fees ${suffix}`);
    const actionB = await action(b, `Blair fees ${suffix}`);

    // The team works the queue and opens both people's requests; the agent writes for Alex.
    const queue = await listQueue(admin, ONLY_OURS(), { client });
    expect(queue.map((q) => q.id)).toEqual(expect.arrayContaining([actionA, actionB]));
    await getActionForAdmin(admin, actionA, { client });
    await getActionForAdmin(admin, actionB, { client });
    await changeActionStatus(
      admin,
      actionA,
      {
        status: "in_progress",
        assignee: adminEmail,
        notes: null,
        userTodo: null,
        failureReason: null,
        minutesSpent: null,
      },
      { client, notify },
    );
    await logAudit(
      SYSTEM_ACTOR,
      "agent_message_sent",
      { type: "action", id: actionA },
      { user_id: a, follow_up: false },
    );
    // Alex's own doing isn't team access.
    await logAudit({ type: "user", id: a }, "data_exported", { type: "user", id: a });

    const alex = await teamAccessFor(a, { client });
    // Rows written in the same millisecond may tie, so the order is checked in the unit tests.
    expect(alex.map((e) => `${e.who}: ${e.what}`).sort()).toEqual(
      [
        `${AGENT}: Wrote to Alex fees ${suffix} Co`,
        `${TEAM}: Gave it to a team member`,
        `${TEAM}: Started working on it`,
        `${TEAM}: Viewed your request`,
        `${TEAM}: Saw your request in the team's list`,
      ].sort(),
    );
    expect(new Set(alex.map((e) => e.why))).toEqual(new Set([`Alex fees ${suffix}`]));
    expect(new Set(alex.map((e) => e.actionId))).toEqual(new Set([actionA]));

    const blair = await teamAccessFor(b, { client });
    expect(blair.map((e) => e.what).sort()).toEqual([
      "Saw your request in the team's list",
      "Viewed your request",
    ]);

    for (const [entries, other] of [
      [alex, "Blair"],
      [blair, "Alex"],
    ] as const) {
      const text = JSON.stringify(entries);
      expect(text).not.toContain(other);
      expect(text).not.toContain(adminEmail);
      expect(text).not.toContain(admin.id);
    }
  });

  it("accounts for every team view of the person's data in the audit log", async () => {
    const theirs = await client.action.findMany({ where: { userId: a }, select: { id: true } });
    const rows = await teamRowsAbout(
      a,
      theirs.map((t) => t.id),
    );
    const views = rows.filter((r) => r.event.startsWith("admin_viewed_"));
    expect(views.map((r) => r.event).sort()).toEqual(["admin_viewed_action", "admin_viewed_queue"]);
    // A queue view naming one action is one entry; everything else is one entry per row.
    expect(await teamAccessFor(a, { client })).toHaveLength(rows.length);
    // The assignment names the team member by user id, never by email.
    const assigned = rows.find((r) => r.event === "action_assigned");
    expect(assigned?.metadata).toMatchObject({ from: NOT_ON_TEAM, to: admin.id });
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain("@");
  });

  it("logs a queue view for every person whose action was listed", async () => {
    const before = new Date();
    const queue = await listQueue(admin, ONLY_OURS(), { client });
    const people = new Set(queue.map((q) => q.userId));
    const rows = await client.auditLog.findMany({
      where: { event: "admin_viewed_queue", actorId: admin.id, createdAt: { gte: before } },
    });
    expect(new Set(rows.map((r) => r.targetId))).toEqual(people);
    for (const r of rows) {
      const ids = String((r.metadata as { action_ids?: string }).action_ids).split(",");
      expect(ids.sort()).toEqual(
        queue
          .filter((q) => q.userId === r.targetId)
          .map((q) => q.id)
          .sort(),
      );
      // Ids only: no one's email, not the person's and not the assignee filter's.
      expect(JSON.stringify(r.metadata)).not.toContain("@");
    }
  });

  it("keeps an undone request's entries, without a link", async () => {
    const gone = await action(a, `Undone ${suffix}`);
    await getActionForAdmin(admin, gone, { client });
    await client.action.delete({ where: { id: gone } });

    const [latest] = await teamAccessFor(a, { client });
    expect(latest).toMatchObject({ what: "Viewed your request", why: UNDONE_WHY, actionId: null });
    expect(await teamAccessFor(b, { client })).not.toContainEqual(
      expect.objectContaining({ why: UNDONE_WHY }),
    );
  });

  it("excludes the person's own events when they're on the team themselves", async () => {
    const mine = await action(admin.id, `Own ${suffix}`);
    await getActionForAdmin(admin, mine, { client });
    expect(await teamAccessFor(admin.id, { client })).toEqual([]);
  });

  it("caps the page and gives the full list to Download my data", async () => {
    const full = await teamAccessFor(a, { client, limit: null });
    expect(await teamAccessFor(a, { client, limit: 2 })).toEqual(full.slice(0, 2));

    const exported = await exportUserData(a, { client });
    expect(exported.teamAccess).toHaveLength(full.length);
    expect(exported.teamAccess[0]).toEqual({
      at: full[0].at,
      who: full[0].who,
      what: full[0].what,
      why: full[0].why,
      actionId: full[0].actionId,
    });
    const text = JSON.stringify(exported.teamAccess);
    expect(text).not.toContain(adminEmail);
    expect(text).not.toContain(admin.id);
  });
});
