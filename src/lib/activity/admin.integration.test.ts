import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { recordActivity } from "./record";
import { loadActivityOverview, loadActivityTimeline } from "./admin";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const ADMIN = { id: "admin-activity-test" };

describe.runIf(url)("the beta's activity log against a real database", () => {
  let client: PrismaClient;
  const tag = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const ids = {
    acted: `act${tag}`,
    linked: `lnk${tag}`,
    fresh: `new${tag}`,
    demo: `dem${tag}`,
    trial: `trial_${tag}`,
    admin: `adm${tag}`,
  };
  const at = (minutesAgo: number) => Date.now() - minutesAgo * 60_000;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    for (const [key, id] of Object.entries(ids)) {
      await client.user.create({
        data: { id, email: `${id}@example.test`, role: key === "admin" ? "admin" : "user" },
      });
    }
    await client.account.create({
      data: {
        userId: ids.acted,
        source: "csv",
        name: "Card",
        type: "credit",
        subtype: "credit card",
      },
    });
    await client.plaidItem.create({
      data: { userId: ids.linked, plaidItemId: `item-${tag}`, accessTokenEncrypted: "x" },
    });
    await client.plaidItem.create({
      data: { userId: ids.demo, plaidItemId: `demo-${tag}`, accessTokenEncrypted: "x" },
    });
    const finding = await client.finding.create({
      data: { userId: ids.acted, type: "bank_fees", key: "k", title: "Fees", confidence: "high" },
    });
    await client.decision.create({
      data: { userId: ids.acted, findingId: finding.id, choice: "yes", cardSnapshot: {} },
    });
    await client.analyticsEvent.create({
      data: { userId: ids.acted, name: "diy_started", properties: { finding_type: "bank_fees" } },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await client.$disconnect();
  });

  beforeEach(() => vi.mocked(logAudit).mockReset());

  const batch = (visitId: string, events: unknown[]) => ({ visitId, events });

  it("stores a beta user's clicks, and nothing for trial, admin or demo-bank people", async () => {
    const events = [
      { kind: "page_view", path: "/subscriptions", at: at(5) },
      {
        kind: "click",
        path: "/subscriptions",
        at: at(4),
        role: "button",
        label: "Cancel Netflix $15.99",
      },
      {
        kind: "blur",
        path: "/chat",
        at: at(3),
        label: "message",
        data: { typed: true, length: 12, value: "hi there" },
      },
    ];
    for (const key of ["acted", "trial", "admin", "demo"] as const) {
      await recordActivity(
        { id: ids[key], role: key === "admin" ? "admin" : "user" },
        batch(`v${tag}`, events),
        {
          client,
        },
      );
    }
    const rows = await client.activityEvent.findMany({
      where: { userId: { in: Object.values(ids) } },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => [r.userId, r.kind, r.label])).toEqual([
      [ids.acted, "page_view", null],
      [ids.acted, "click", "Cancel Netflix #"],
      [ids.acted, "blur", "message"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("hi there");
  });

  it("lists beta users with their furthest step, and logs the view", async () => {
    const { people } = await loadActivityOverview(ADMIN, { client });
    const ours = new Map(
      people.filter((p) => Object.values(ids).includes(p.id)).map((p) => [p.id, p]),
    );
    expect([...ours.keys()].sort()).toEqual([ids.acted, ids.fresh, ids.linked].sort());
    expect(ours.get(ids.acted)).toMatchObject({ reached: "Acted on a card", visits: 1, events: 3 });
    expect(ours.get(ids.linked)).toMatchObject({ reached: "Uploaded or linked", lastSeen: null });
    expect(ours.get(ids.fresh)).toMatchObject({ reached: "Signed up", events: 0 });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: ADMIN.id },
      "admin_viewed_activity",
      null,
      { view: "list" },
    );
  });

  it("shows one person's visit in plain words, and logs whose it was", async () => {
    const timeline = await loadActivityTimeline(ADMIN, ids.acted, { client });
    expect(timeline?.person.email).toBe(`${ids.acted}@example.test`);
    const lines = timeline!.visits.flatMap((v) => v.lines.map((l) => l.text));
    expect(lines).toEqual(
      expect.arrayContaining([
        "opened Subscriptions",
        "clicked 'Cancel Netflix #'",
        "typed in 'message' (12 characters)",
        "chose 'Do it myself' on a card (finding type: bank fees)",
      ]),
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: ADMIN.id },
      "admin_viewed_activity",
      { type: "user", id: ids.acted },
      { view: "timeline" },
    );
  });

  it("has no timeline for an admin or a trial person", async () => {
    expect(await loadActivityTimeline(ADMIN, ids.admin, { client })).toBeNull();
    expect(await loadActivityTimeline(ADMIN, ids.trial, { client })).toBeNull();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("goes with the person when they delete their data", async () => {
    await client.user.delete({ where: { id: ids.fresh } });
    await recordActivity(
      { id: ids.linked, role: "user" },
      batch(`w${tag}`, [{ kind: "page_view", path: "/home", at: at(1) }]),
      { client },
    );
    expect(await client.activityEvent.count({ where: { userId: ids.linked } })).toBe(1);
    await client.user.delete({ where: { id: ids.linked } });
    expect(await client.activityEvent.count({ where: { userId: ids.linked } })).toBe(0);
  });
});
