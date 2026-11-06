import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Two of the pipeline's limits against a real, migrated Postgres: the daily amount counts what runs,
// not only what was said yes to, and a check that fails for another reason doesn't strand an action.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const flaky = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/concierge-mode", async (original) => {
  const real = await original<typeof import("@/lib/concierge-mode")>();
  return {
    ...real,
    onSampleDataOnly: async (...args: Parameters<typeof real.onSampleDataOnly>) => {
      if (flaky.fail) throw new Error("Connection reset");
      return real.onSampleDataOnly(...args);
    },
  };
});

import { CONNECTOR_DAILY_CENTS, CONNECTOR_HOLD_MINUTES } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { fakeSandbox, type FakeCalls } from "./__fixtures__/connectors";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { grantConsent } from "./consent";
import { answerAction, cancelAction, executeAction, planAction } from "./pipeline";
import { useConnectorsForTests } from "./registry";

const url = process.env.TEST_DATABASE_URL;
const MINUTE = 60 * 1000;
const T0 = new Date(Date.now() - 5 * 24 * 60 * MINUTE);
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);
const HALF_THE_DAY = CONNECTOR_DAILY_CENTS / 2;

describe.runIf(url)("the connector pipeline's limits", () => {
  const people: string[] = [];
  let calls: FakeCalls;
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("CONNECTORS_KILLED", "");
    const money = fakeSandbox({ id: "fake_money", movesMoney: true });
    calls = money.calls;
    const other = fakeSandbox({ id: "fake_other", movesMoney: false }).connector;
    useConnectorsForTests([money.connector, other]);
  });
  afterAll(async () => {
    useConnectorsForTests(null);
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });

  async function person() {
    const userId = await samplePerson(db);
    people.push(userId);
    await grantConsent(userId, "fake_money", ["pay_bills"], { now: T0 });
    await grantConsent(userId, "fake_other", ["pay_bills"], { now: T0 });
    return userId;
  }
  async function planned(userId: string, connectorId: string, cents: number, minute: number) {
    return planAction(
      userId,
      connectorId,
      { payee: "Con Edison", amountCents: cents },
      { idempotencyKey: crypto.randomUUID(), now: at(minute) },
    );
  }
  async function yesTo(userId: string, connectorId: string, cents: number, minute: number) {
    const plan = await planned(userId, connectorId, cents, minute);
    const yes = {
      yes: true as const,
      amountCents: plan.amountCents,
      fingerprint: plan.fingerprint,
    };
    await answerAction(userId, plan.id, yes, { now: at(minute) });
    return plan.id;
  }

  it("counts what ran in the last day, so a day's hold doesn't double the daily amount", async () => {
    const userId = await person();
    // A day's worth of money, said yes to at T0; it runs a day later, after its hold.
    const first = [
      await yesTo(userId, "fake_money", HALF_THE_DAY, 0),
      await yesTo(userId, "fake_money", HALF_THE_DAY, 0),
    ];
    const ran = CONNECTOR_HOLD_MINUTES.money + 1;
    for (const id of first) await executeAction(userId, id, { now: at(ran) });

    // A minute after those ran, another day's worth through a short hold is refused at the yes.
    await expect(yesTo(userId, "fake_other", HALF_THE_DAY, ran + 1)).rejects.toMatchObject({
      reason: "daily_amount",
    });
    const done = await systemDb("Test: reads what ran", db).connectorAction.findMany({
      where: { userId, status: { in: ["succeeded", "partner_pending"] } },
      select: { amountCents: true },
    });
    expect(done.reduce((sum, row) => sum + row.amountCents, 0)).toBeLessThanOrEqual(
      CONNECTOR_DAILY_CENTS,
    );
    // A day after they ran, there's room again.
    await expect(yesTo(userId, "fake_other", HALF_THE_DAY, ran + 24 * 60 + 1)).resolves.toEqual(
      expect.any(String),
    );
  });

  it("hands the claim back when a check fails for another reason, so a retry or cancel works", async () => {
    const userId = await person();
    const id = await yesTo(userId, "fake_money", 500, 0);
    const due = at(CONNECTOR_HOLD_MINUTES.money + 1);
    const status = async () =>
      (
        await systemDb("Test: reads the status", db).connectorAction.findUniqueOrThrow({
          where: { id },
        })
      ).status;

    flaky.fail = true;
    await expect(executeAction(userId, id, { now: due })).rejects.toThrow("Connection reset");
    flaky.fail = false;
    expect(await status()).toBe("approved");
    const before = calls.act.length;
    await expect(executeAction(userId, id, { now: due })).resolves.toBe("partner_pending");
    expect(calls.act.length - before).toBe(1);

    // And one that fails then is cancelled instead of retried: the cancel takes.
    const second = await yesTo(userId, "fake_money", 500, 0);
    flaky.fail = true;
    await expect(executeAction(userId, second, { now: due })).rejects.toThrow();
    flaky.fail = false;
    await expect(cancelAction(userId, second, { now: due })).resolves.toBe(true);
  });
});
