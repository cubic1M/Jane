import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// "Jane shows, you open and move it" end to end on a real account, against a real, migrated
// Postgres, with its switch turned on inside this test only. Nothing is sent anywhere.

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
import { SAVINGS_APY_STALE_DAYS } from "@/config/compare";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople } from "../__fixtures__/people";
import { grantConsent } from "../consent";
import { answerAction, executeAction, planAction } from "../pipeline";
import { NOT_A_BANK } from "./savings";
import { settleManualPayments } from "./settle";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: options, people and their lines", db);
const MINUTE = 60 * 1000;
const NOW = new Date("2026-11-06T15:00:00Z");
const LATER = new Date(NOW.getTime() + (CONNECTOR_HOLD_MINUTES.other + 1) * MINUTE);

describe.runIf(url)('"Jane shows, you open and move it"', () => {
  const people: string[] = [];
  const options: string[] = [];

  async function person(balanceCents = 1_200_000) {
    const userId = await realPerson(db);
    people.push(userId);
    const account = await system().account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: balanceCents,
      },
    });
    await grantConsent(userId, "manual_open_savings", ["prefill_payments"], { now: NOW });
    return { userId, accountId: account.id };
  }
  async function option(over: Record<string, unknown> = {}) {
    const row = await system().switchOption.create({
      data: {
        kind: "savings",
        category: "savings",
        provider: "Ally Bank",
        name: "Online Savings",
        apyBps: 380,
        minimumBalanceCents: 0,
        signUpUrl: "https://www.ally.com/bank/online-savings-account/",
        sourceUrl: "https://www.ally.com/bank/online-savings-account/",
        checkedAt: new Date("2026-11-05T00:00:00Z"),
        reviewedAt: NOW,
        ...over,
      },
    });
    options.push(row.id);
    return row.id;
  }
  const request = (accountId: string, optionId: string, over: Record<string, unknown> = {}) => ({
    optionId,
    fromAccountId: accountId,
    amountCents: 80_000,
    today: "2026-11-06",
    ...over,
  });
  const plan = (userId: string, details: Record<string, unknown>) =>
    planAction(userId, "manual_open_savings", details as never, {
      idempotencyKey: crypto.randomUUID(),
      now: NOW,
    });
  const line = (userId: string, accountId: string, date: string, cents: number, text: string) =>
    system().transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: new Date(`${date}T00:00:00Z`),
        amountCents: cents,
        description: text,
      },
    });

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    await system().switchOption.deleteMany({ where: { id: { in: options } } });
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    flags.real.manual_open_savings = true;
  });
  afterEach(() => {
    for (const key of Object.keys(flags.real)) delete flags.real[key];
  });

  it("is off until its switch", async () => {
    delete flags.real.manual_open_savings;
    const userId = await realPerson(db);
    people.push(userId);
    await expect(
      grantConsent(userId, "manual_open_savings", ["prefill_payments"]),
    ).rejects.toMatchObject({ reason: "switched_off" });
  });

  it("shows the rate the Reg DD way and never says FDIC insured", async () => {
    const { userId, accountId } = await person();
    const planned = await plan(userId, request(accountId, await option()));
    const text = planned.steps.map((s) => `${s.label}: ${s.value}`).join("\n");
    expect(text).toContain("Annual Percentage Yield (APY) 3.80% as of 2026-11-05");
    expect(text).toContain("Rate may change after the account is opened.");
    expect(text).toContain("Fees could reduce the earnings on the account.");
    expect(text).toContain(NOT_A_BANK);
    expect(text).not.toMatch(/(?<!not )FDIC insured/i);
    expect(planned.steps.find((s) => s.label === "Link")!.value).toBe(
      "In their sign-up, link your Checking",
    );
  });

  it("only from a reviewed, current savings option, the person's own account, and what it holds", async () => {
    const { userId, accountId } = await person(50_000);
    const stranger = await person();
    const stale = new Date(NOW.getTime() - (SAVINGS_APY_STALE_DAYS + 1) * 86_400_000);
    const refused = [
      request(accountId, await option({ checkedAt: stale })),
      request(accountId, await option({ reviewedAt: null })),
      request(accountId, await option({ kind: "plan", apyBps: null, monthlyCents: 3000 })),
      request(accountId, await option({ signUpUrl: "http://example.com" })),
      request(stranger.accountId, await option()),
      // More than checking holds ($500).
      request(accountId, await option()),
    ];
    for (const details of refused) {
      await expect(plan(userId, details)).rejects.toMatchObject({ reason: "check_failed" });
    }
    await expect(
      plan(
        userId,
        request(accountId, await option({ minimumBalanceCents: 1_000_000 }), {
          amountCents: 40_000,
        }),
      ),
    ).rejects.toMatchObject({ reason: "bad_request" });
  });

  it("opens one at a time, then settles on the bank's own pull of the exact amount", async () => {
    const { userId, accountId } = await person();
    const optionId = await option();
    const planned = await plan(userId, request(accountId, optionId));
    await expect(plan(userId, request(accountId, optionId))).rejects.toMatchObject({
      reason: "check_failed",
    });
    await answerAction(
      userId,
      planned.id,
      { yes: true, amountCents: 80_000, fingerprint: planned.fingerprint },
      { now: NOW },
    );
    await expect(executeAction(userId, planned.id, { now: LATER })).resolves.toBe("handed_off");
    // A same-amount line that doesn't name the bank isn't the deposit.
    await line(userId, accountId, "2026-11-09", 80_000, "ONLINE TRANSFER");
    expect(await settleManualPayments(userId, { now: LATER })).toBe(0);
    await line(userId, accountId, "2026-11-10", 80_000, "ALLY BANK $TRANSFER");
    expect(await settleManualPayments(userId, { now: LATER })).toBe(1);
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    expect(row).toMatchObject({
      status: "succeeded",
      note: "Moved: Ally Bank took the deposit on 2026-11-10.",
    });
  });
});
