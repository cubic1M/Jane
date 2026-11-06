import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The action pipeline against a real, migrated Postgres: plan, the person's yes or no, the hold,
// execution through the jobs queue, cancelling, and the settings page's actions as the wrong person.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: session.userId })),
  getCurrentUser: vi.fn(async () => ({ id: session.userId })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { answerConnectorAction, cancelConnectorAction } from "@/app/settings/connections/actions";
import {
  CONNECTOR_ACTION_CAP_CENTS,
  CONNECTOR_DAILY_ACTIONS,
  CONNECTOR_HOLD_MINUTES,
} from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { runDueJobs } from "@/lib/jobs";
import { systemDb } from "@/lib/system-db";
import { fakeConnector, fakeSandbox, type FakeCalls } from "./__fixtures__/connectors";
import { realPerson, removePeople, samplePerson, trialPerson } from "./__fixtures__/people";
import { grantConsent, revokeConsent } from "./consent";
import {
  ConnectorRefused,
  answerAction,
  cancelAction,
  executeAction,
  planAction,
  type PlannedAction,
} from "./pipeline";
import { useConnectorsForTests } from "./registry";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: reads what the pipeline wrote", db);
const MINUTE = 60 * 1000;
// In the past, so the jobs queue (which runs its handlers at the real time) finds it due.
const T0 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const afterHold = new Date(T0.getTime() + (CONNECTOR_HOLD_MINUTES.money + 1) * MINUTE);

const form = (fields: Record<string, string | number>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, String(value));
  return data;
};

describe.runIf(url)("the connector action pipeline", () => {
  const people: string[] = [];
  let calls: FakeCalls;

  const yes = (plan: PlannedAction) => ({
    yes: true as const,
    amountCents: plan.amountCents,
    fingerprint: plan.fingerprint,
  });
  const statusOf = async (id: string) =>
    (await system().connectorAction.findUniqueOrThrow({ where: { id } })).status;

  async function sample() {
    const id = await samplePerson(db);
    people.push(id);
    await grantConsent(id, "fake_sandbox", ["pay_bills"], { now: T0 });
    return id;
  }
  const plan = (userId: string, cents = 8412, key = crypto.randomUUID(), dryRun = false) =>
    planAction(
      userId,
      "fake_sandbox",
      { payee: "Con Edison", amountCents: cents },
      { idempotencyKey: key, dryRun, now: T0 },
    );

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("CONNECTORS_KILLED", "");
    const fake = fakeSandbox({
      act: async (_draft, context) => {
        calls.act.push(context);
        return {
          externalRef: `ext_${context.actionId}`,
          state: "pending",
          cancelUntil: new Date(context.now.getTime() + 15 * MINUTE),
          note: "Sent to the sandbox",
        };
      },
    });
    calls = fake.calls;
    useConnectorsForTests([fake.connector, fakeConnector().connector]);
  });
  afterEach(() => useConnectorsForTests(null));

  describe("planning", () => {
    it("refuses while off, without consent, for a real account and over the cap", async () => {
      const userId = await sample();
      vi.stubEnv("CONNECTORS", "");
      await expect(plan(userId)).rejects.toMatchObject({ reason: "off" });
      vi.stubEnv("CONNECTORS", "1");
      await revokeConsent(userId, "fake_sandbox");
      await expect(plan(userId)).rejects.toMatchObject({ reason: "no_consent" });
      const real = await realPerson(db);
      people.push(real);
      await expect(plan(real)).rejects.toMatchObject({ reason: "sandbox_for_samples" });
      await expect(
        planAction(real, "fake_bills", { amountCents: 100 }, { idempotencyKey: "k", now: T0 }),
      ).rejects.toMatchObject({ reason: "switched_off" });
      const trial = await trialPerson(db);
      people.push(trial);
      await expect(
        planAction(trial, "fake_bills", { amountCents: 100 }, { idempotencyKey: "k", now: T0 }),
      ).rejects.toMatchObject({ reason: "trial" });
      const other = await sample();
      await expect(plan(other, CONNECTOR_ACTION_CAP_CENTS + 1)).rejects.toMatchObject({
        reason: "over_cap",
      });
      await expect(plan(other, -5)).rejects.toMatchObject({ reason: "bad_amount" });
    });

    it("returns the first plan for the same key, and refuses the key for something else", async () => {
      const userId = await sample();
      const first = await plan(userId, 8412, "bill-oct");
      const again = await plan(userId, 8412, "bill-oct");
      expect(again.id).toBe(first.id);
      const [both1, both2] = await Promise.all([
        plan(userId, 500, "race"),
        plan(userId, 500, "race"),
      ]);
      expect(both1.id).toBe(both2.id);
      await expect(plan(userId, 9999, "bill-oct")).rejects.toMatchObject({ reason: "key_reused" });
      expect(first.steps).toEqual([
        { label: "Pay to", value: "Con Edison" },
        { label: "Amount", value: "$84.12" },
      ]);
      expect(await statusOf(first.id)).toBe("awaiting_yes");
      expect(calls.act).toHaveLength(0);
    });
  });

  describe("the yes", () => {
    it("counts only for the exact amount and action shown", async () => {
      const userId = await sample();
      const planned = await plan(userId);
      await expect(
        answerAction(userId, planned.id, { ...yes(planned), amountCents: 8413 }, { now: T0 }),
      ).rejects.toMatchObject({ reason: "changed" });
      await expect(
        answerAction(userId, planned.id, { ...yes(planned), fingerprint: "x" }, { now: T0 }),
      ).rejects.toMatchObject({ reason: "changed" });
      expect(await statusOf(planned.id)).toBe("awaiting_yes");
      await expect(answerAction(userId, planned.id, yes(planned), { now: T0 })).resolves.toBe(
        "approved",
      );
    });

    it("expires if not answered in time", async () => {
      const userId = await sample();
      const planned = await plan(userId);
      const late = new Date(T0.getTime() + 4 * 24 * 60 * MINUTE);
      await expect(answerAction(userId, planned.id, yes(planned), { now: late })).rejects.toThrow(
        ConnectorRefused,
      );
      expect(await statusOf(planned.id)).toBe("refused");
    });

    it("a no ends it, and a yes after that does nothing", async () => {
      const userId = await sample();
      const planned = await plan(userId);
      await expect(answerAction(userId, planned.id, { yes: false }, { now: T0 })).resolves.toBe(
        "declined",
      );
      await expect(answerAction(userId, planned.id, yes(planned), { now: T0 })).resolves.toBe(
        "declined",
      );
    });

    it("queues it once, after the hold, however many taps arrive together", async () => {
      const userId = await sample();
      const planned = await plan(userId);
      const answers = await Promise.all(
        Array.from({ length: 6 }, () =>
          answerAction(userId, planned.id, yes(planned), { now: T0 }),
        ),
      );
      expect(new Set(answers)).toEqual(new Set(["approved"]));
      const jobs = await system().job.findMany({
        where: { kind: "connector_execute", payload: { path: ["actionId"], equals: planned.id } },
      });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.runAt.getTime()).toBe(T0.getTime() + CONNECTOR_HOLD_MINUTES.money * MINUTE);
      const approvals = await system().auditLog.count({
        where: { event: "connector_action_approved", targetId: userId },
      });
      expect(approvals).toBe(1);
    });

    it("stops at the daily count", async () => {
      const userId = await sample();
      for (let i = 0; i < CONNECTOR_DAILY_ACTIONS; i++) {
        const planned = await plan(userId, 100);
        await answerAction(userId, planned.id, yes(planned), { now: T0 });
      }
      const extra = await plan(userId, 100);
      await expect(answerAction(userId, extra.id, yes(extra), { now: T0 })).rejects.toMatchObject({
        reason: "daily_count",
      });
    });
  });

  describe("running it", () => {
    async function approved(dryRun = false) {
      const userId = await sample();
      const planned = await plan(userId, 8412, crypto.randomUUID(), dryRun);
      await answerAction(userId, planned.id, yes(planned), { now: T0 });
      return { userId, id: planned.id };
    }

    it("waits out the hold, then acts once through the jobs queue", async () => {
      const { userId, id } = await approved();
      await expect(executeAction(userId, id, { now: T0 })).resolves.toBe("skipped");
      expect(calls.act).toHaveLength(0);
      await runDueJobs({ now: afterHold, userIds: [userId] });
      expect(calls.act).toHaveLength(1);
      expect(calls.act[0]).toMatchObject({ userId, actionId: id, idempotencyKey: `jane_${id}` });
      const row = await system().connectorAction.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        status: "partner_pending",
        externalRef: `ext_${id}`,
        simulated: true,
      });
      await expect(executeAction(userId, id, { now: afterHold })).resolves.toBe("skipped");
      expect(calls.act).toHaveLength(1);
    });

    it("runs once when runners race", async () => {
      const { userId, id } = await approved();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => executeAction(userId, id, { now: afterHold })),
      );
      expect(results.filter((r) => r !== "skipped")).toEqual(["partner_pending"]);
      expect(calls.act).toHaveLength(1);
    });

    it("a dry run goes through every check and sends nothing", async () => {
      const { userId, id } = await approved(true);
      await expect(executeAction(userId, id, { now: afterHold })).resolves.toBe("succeeded");
      expect(calls.act).toHaveLength(0);
      const row = await system().connectorAction.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ simulated: true, note: "Dry run: nothing was sent." });
    });

    it("checks again when it comes to run: kill switch, flags, consent, tampering", async () => {
      const killed = await approved();
      vi.stubEnv("KILL_CONNECTORS", "1");
      await expect(executeAction(killed.userId, killed.id, { now: afterHold })).resolves.toBe(
        "refused",
      );
      vi.stubEnv("KILL_CONNECTORS", "");
      const off = await approved();
      vi.stubEnv("CONNECTORS", "");
      await expect(executeAction(off.userId, off.id, { now: afterHold })).resolves.toBe("refused");
      vi.stubEnv("CONNECTORS", "1");
      const unconsented = await approved();
      await system().connectorConsent.updateMany({
        where: { userId: unconsented.userId },
        data: { revokedAt: T0 },
      });
      await expect(
        executeAction(unconsented.userId, unconsented.id, { now: afterHold }),
      ).resolves.toBe("refused");
      const tampered = await approved();
      await system().connectorAction.update({
        where: { id: tampered.id },
        data: { details: { payee: "Someone Else", amountCents: 8412 } },
      });
      await expect(executeAction(tampered.userId, tampered.id, { now: afterHold })).resolves.toBe(
        "refused",
      );
      expect(calls.act).toHaveLength(0);
      const reasons = await system().connectorAction.findMany({
        where: { id: { in: [killed.id, off.id, unconsented.id, tampered.id] } },
        select: { reason: true },
      });
      expect(reasons.map((r) => r.reason).sort()).toEqual(
        ["changed", "killed", "no_consent", "off"].sort(),
      );
    });

    it("is cancelled during the hold, in Jane, even with the connectors killed", async () => {
      const { userId, id } = await approved();
      vi.stubEnv("KILL_CONNECTORS", "1");
      await expect(cancelAction(userId, id, { now: T0 })).resolves.toBe(true);
      vi.stubEnv("KILL_CONNECTORS", "");
      await expect(executeAction(userId, id, { now: afterHold })).resolves.toBe("skipped");
      expect(calls.act).toHaveLength(0);
    });

    it("is cancelled at the partner while it allows, and not after", async () => {
      const { userId, id } = await approved();
      await executeAction(userId, id, { now: afterHold });
      await expect(
        cancelAction(userId, id, { now: new Date(afterHold.getTime() + 20 * MINUTE) }),
      ).resolves.toBe(false);
      expect(calls.cancel).toEqual([]);
      await expect(cancelAction(userId, id, { now: afterHold })).resolves.toBe(true);
      expect(calls.cancel).toEqual([`ext_${id}`]);
      expect(await statusOf(id)).toBe("cancelled");
    });

    it("revoking consent cancels what hasn't run", async () => {
      const { userId, id } = await approved();
      await revokeConsent(userId, "fake_sandbox");
      expect(await statusOf(id)).toBe("cancelled");
    });

    it("audits and counts every step", async () => {
      const { userId, id } = await approved();
      await executeAction(userId, id, { now: afterHold });
      const events = await system().auditLog.findMany({
        where: { targetId: userId, event: { startsWith: "connector_action" } },
        select: { event: true },
      });
      expect(events.map((e) => e.event).sort()).toEqual(
        [
          "connector_action_approved",
          "connector_action_executed",
          "connector_action_planned",
        ].sort(),
      );
      const funnel = await system().analyticsEvent.findMany({
        where: { userId, name: { startsWith: "connector_action" } },
        select: { name: true },
      });
      expect(funnel.map((e) => e.name).sort()).toEqual(
        [
          "connector_action_approved",
          "connector_action_partner_pending",
          "connector_action_planned",
        ].sort(),
      );
    });
  });

  describe("as the wrong person", () => {
    it("can't answer, cancel or run someone else's action", async () => {
      const victim = await sample();
      const attacker = await sample();
      const planned = await plan(victim);
      session.userId = attacker;
      await answerConnectorAction(
        form({
          actionId: planned.id,
          answer: "yes",
          amountCents: planned.amountCents,
          fingerprint: planned.fingerprint,
        }),
      );
      expect(await statusOf(planned.id)).toBe("awaiting_yes");
      await answerAction(victim, planned.id, yes(planned), { now: T0 });
      await cancelConnectorAction(form({ actionId: planned.id }));
      expect(await statusOf(planned.id)).toBe("approved");
      await expect(executeAction(attacker, planned.id, { now: afterHold })).resolves.toBe(
        "skipped",
      );
      expect(calls.act).toHaveLength(0);
    });

    it("the page's yes works for the signed-in person", async () => {
      const userId = await sample();
      // Now, not T0: the page answers at the real time.
      const planned = await planAction(
        userId,
        "fake_sandbox",
        { payee: "Con Edison", amountCents: 8412 },
        { idempotencyKey: crypto.randomUUID() },
      );
      session.userId = userId;
      await answerConnectorAction(
        form({
          actionId: planned.id,
          answer: "yes",
          amountCents: planned.amountCents,
          fingerprint: planned.fingerprint,
        }),
      );
      expect(await statusOf(planned.id)).toBe("approved");
      await cancelConnectorAction(form({ actionId: planned.id }));
      expect(await statusOf(planned.id)).toBe("cancelled");
    });
  });
});
