import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The day a manual payment or move is planned on is the person's own, never the caller's word: a
// caller's earlier "today" would open the settlement window on a line from before the plan (last
// month's payment marking this month's bill paid), or set a move for a day already gone.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const flags = vi.hoisted(() => ({ real: {} as Record<string, boolean> }));
vi.mock("@/config/connectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/connectors")>()),
  REAL_CONNECTORS: flags.real,
}));

import { CONNECTOR_HOLD_MINUTES } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople } from "../__fixtures__/people";
import { grantConsent } from "../consent";
import { answerAction, executeAction, planAction } from "../pipeline";
import { settleManualPayments } from "./settle";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: makes and reads a person's bank lines", db);
// 7 AM in US Pacific, so the person's day is 2026-11-06 whatever their zone defaults to.
const NOW = new Date("2026-11-06T15:00:00Z");
const LATER = new Date(NOW.getTime() + (CONNECTOR_HOLD_MINUTES.other + 1) * 60_000);

describe.runIf(url)("a manual payment's day", () => {
  const people: string[] = [];

  async function withChecking() {
    const userId = await realPerson(db);
    people.push(userId);
    const account = await system().account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    return { userId, accountId: account.id };
  }

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    for (const key of Object.keys(flags.real)) delete flags.real[key];
  });

  it("is today, so last month's payment doesn't mark this one paid", async () => {
    flags.real.manual_bill_pay = true;
    const { userId, accountId } = await withChecking();
    await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
    const planned = await planAction(
      userId,
      "manual_bill_pay",
      {
        biller: "Con Edison",
        amountCents: 8412,
        dueOn: "2026-10-05",
        // A month early.
        today: "2026-10-01",
        fromAccount: "Checking",
        fromAccountId: accountId,
      },
      { idempotencyKey: crypto.randomUUID(), now: NOW },
    );
    expect(planned.steps).toContainEqual({ label: "Pay on", value: "2026-11-06, before 7 PM ET" });
    await answerAction(
      userId,
      planned.id,
      { yes: true, amountCents: 8412, fingerprint: planned.fingerprint },
      { now: NOW },
    );
    await expect(executeAction(userId, planned.id, { now: LATER })).resolves.toBe("handed_off");
    // Last month's payment of the same bill, the same amount.
    await system().transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: new Date("2026-10-02T00:00:00Z"),
        amountCents: 8412,
        description: "CON EDISON ONLINE PMT",
      },
    });
    expect(await settleManualPayments(userId, { now: LATER })).toBe(0);
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    expect(row.status).toBe("handed_off");
  });

  it("is today, so a move can't be set for a day already gone", async () => {
    flags.real.manual_own_transfer = true;
    const { userId, accountId } = await withChecking();
    const savings = await system().account.create({
      data: { userId, source: "csv", name: "Savings", type: "depository", subtype: "savings" },
    });
    await grantConsent(userId, "manual_own_transfer", ["prefill_payments"], { now: NOW });
    await expect(
      planAction(
        userId,
        "manual_own_transfer",
        {
          fromAccount: "Checking",
          fromAccountId: accountId,
          toAccount: "Savings",
          toAccountId: savings.id,
          amountCents: 25_000,
          today: "2026-10-01",
          on: "2026-10-02",
        },
        { idempotencyKey: crypto.randomUUID(), now: NOW },
      ),
    ).rejects.toMatchObject({ name: "ConnectorRefused" });
  });
});
