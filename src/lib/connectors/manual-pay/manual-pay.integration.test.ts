import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// "Jane prepares, you pay" end to end on a real account, against a real, migrated Postgres: off by
// default, then with its switch turned on inside this test only: prefill, the yes, handed to the
// person, and settled from their own transactions. Nothing is sent anywhere.

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
import { scopedFor } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople, trialPerson } from "../__fixtures__/people";
import { grantConsent } from "../consent";
import { answerAction, executeAction, planAction } from "../pipeline";
import { autopayOn, settleManualPayments } from "./settle";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: makes and reads a person's bank lines", db);
const MINUTE = 60 * 1000;
const NOW = new Date("2026-11-06T15:00:00Z");
const LATER = new Date(NOW.getTime() + (CONNECTOR_HOLD_MINUTES.other + 1) * MINUTE);

describe.runIf(url)('"Jane prepares, you pay"', () => {
  const people: string[] = [];

  async function withChecking() {
    const userId = await realPerson(db);
    people.push(userId);
    const account = await system().account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    return { userId, accountId: account.id };
  }
  const bankLine = (userId: string, accountId: string, date: string, cents: number, text: string) =>
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
  const bill = (accountId: string, over: Record<string, string | number | boolean> = {}) => ({
    biller: "Con Edison",
    amountCents: 8412,
    dueOn: "2026-11-20",
    today: "2026-11-06",
    fromAccount: "Checking",
    fromAccountId: accountId,
    ...over,
  });

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
  afterEach(() => vi.restoreAllMocks());

  it("is off until its switch, and never for a trial person", async () => {
    const { userId, accountId } = await withChecking();
    await expect(
      grantConsent(userId, "manual_bill_pay", ["prefill_payments"]),
    ).rejects.toMatchObject({ reason: "switched_off" });
    flags.real.manual_bill_pay = true;
    const trial = await trialPerson(db);
    people.push(trial);
    await expect(
      planAction(trial, "manual_bill_pay", bill(accountId), { idempotencyKey: "t", now: NOW }),
    ).rejects.toMatchObject({ reason: "trial" });
  });

  it("prefills, hands it to the person, and settles from their own transactions", async () => {
    flags.real.manual_bill_pay = true;
    const { userId, accountId } = await withChecking();
    await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
    const planned = await planAction(userId, "manual_bill_pay", bill(accountId), {
      idempotencyKey: crypto.randomUUID(),
      now: NOW,
    });
    expect(planned.steps).toEqual(
      expect.arrayContaining([
        { label: "Pay to", value: "Con Edison" },
        { label: "Pay on", value: "2026-11-17, before 7 PM ET" },
        { label: "Who pays", value: "You do. Jane never sees or types your account numbers." },
      ]),
    );
    expect(planned.steps.find((s) => s.label === "Where")!.value).toMatch(
      /^https:\/\/www\.coned\.com/,
    );
    await answerAction(
      userId,
      planned.id,
      { yes: true, amountCents: 8412, fingerprint: planned.fingerprint },
      { now: NOW },
    );
    const outgoing = vi.fn(async () => {
      throw new Error("nothing leaves");
    });
    vi.stubGlobal("fetch", outgoing);
    await expect(executeAction(userId, planned.id, { now: LATER })).resolves.toBe("handed_off");
    expect(outgoing).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    // Not paid yet, then a line of another amount, then the payment itself two days later.
    expect(await settleManualPayments(userId, { now: LATER })).toBe(0);
    await bankLine(userId, accountId, "2026-11-17", 8400, "CON EDISON PAYMENT");
    expect(await settleManualPayments(userId, { now: LATER })).toBe(0);
    await bankLine(userId, accountId, "2026-11-19", 8412, "CON EDISON ONLINE PMT");
    expect(await settleManualPayments(userId, { now: LATER })).toBe(1);
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    expect(row).toMatchObject({
      status: "succeeded",
      note: "Paid: seen in your account on 2026-11-19.",
    });
    expect(await settleManualPayments(userId, { now: LATER })).toBe(0);
  });

  it("doesn't suggest paying by hand what autopay already pays", async () => {
    flags.real.manual_bill_pay = true;
    const { userId, accountId } = await withChecking();
    await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
    expect(await autopayOn(userId, "Chase", { client: db, now: NOW })).toBe(false);
    await bankLine(userId, accountId, "2026-10-21", 250_00, "CHASE CREDIT CRD AUTOPAY");
    expect(await autopayOn(userId, "Chase", { client: db, now: NOW })).toBe(true);
    await expect(
      planAction(userId, "manual_bill_pay", bill(accountId, { biller: "Chase", autopayOn: true }), {
        idempotencyKey: crypto.randomUUID(),
        now: NOW,
      }),
    ).rejects.toMatchObject({ reason: "check_failed" });
    // Worked out from their lines, whatever the caller says.
    await expect(
      planAction(
        userId,
        "manual_bill_pay",
        bill(accountId, { biller: "Chase", autopayOn: false }),
        { idempotencyKey: crypto.randomUUID(), now: NOW },
      ),
    ).rejects.toMatchObject({ reason: "check_failed" });
    // Buy now, pay later pays itself, even if the caller says autopay is off.
    await expect(
      planAction(
        userId,
        "manual_bill_pay",
        bill(accountId, { biller: "Affirm", autopayOn: false }),
        { idempotencyKey: crypto.randomUUID(), now: NOW },
      ),
    ).rejects.toMatchObject({ reason: "check_failed" });
  });

  // Security review on #1506 and #1508: each of these passed before the fix.
  describe("what the caller can't decide", () => {
    async function approved(userId: string, request: Record<string, string | number | boolean>) {
      const planned = await planAction(userId, "manual_bill_pay", request, {
        idempotencyKey: crypto.randomUUID(),
        now: NOW,
      });
      await answerAction(
        userId,
        planned.id,
        { yes: true, amountCents: planned.amountCents, fingerprint: planned.fingerprint },
        { now: NOW },
      );
      await executeAction(userId, planned.id, { now: LATER });
      return planned;
    }

    it("isn't paid by a same-amount line that doesn't name the biller", async () => {
      flags.real.manual_bill_pay = true;
      const { userId, accountId } = await withChecking();
      await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
      const planned = await approved(userId, bill(accountId, { amountCents: 10_000 }));
      await bankLine(userId, accountId, "2026-11-17", 10_000, "TRADER JOE S #123");
      expect(await settleManualPayments(userId, { now: LATER })).toBe(0);
      const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
      expect(row.status).toBe("handed_off");
      expect(row.note).toMatch(/^Looks paid on 2026-11-17, but the bank line doesn't name them/);
    });

    it("pays only from one of the person's own accounts, named as it is", async () => {
      flags.real.manual_bill_pay = true;
      const { userId, accountId } = await withChecking();
      const stranger = await withChecking();
      await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
      for (const fromAccountId of [stranger.accountId, "not-an-account"]) {
        await expect(
          planAction(userId, "manual_bill_pay", bill(accountId, { fromAccountId }), {
            idempotencyKey: crypto.randomUUID(),
            now: NOW,
          }),
        ).rejects.toMatchObject({ reason: "check_failed" });
      }
      const { fromAccountId: _, ...noAccount } = bill(accountId);
      await expect(
        planAction(userId, "manual_bill_pay", noAccount, {
          idempotencyKey: crypto.randomUUID(),
          now: NOW,
        }),
      ).rejects.toMatchObject({ reason: "check_failed" });
      const planned = await planAction(
        userId,
        "manual_bill_pay",
        bill(accountId, { fromAccount: "Savings ••9999" }),
        { idempotencyKey: crypto.randomUUID(), now: NOW },
      );
      expect(planned.steps.find((s) => s.label === "From")!.value).toBe("Checking");
    });

    it("won't open a second payment of the same bill and due day", async () => {
      flags.real.manual_bill_pay = true;
      const { userId, accountId } = await withChecking();
      await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
      const key = crypto.randomUUID();
      const first = await planAction(userId, "manual_bill_pay", bill(accountId), {
        idempotencyKey: key,
        now: NOW,
      });
      // Asking again with the same key is the same plan, not a twin.
      const again = await planAction(userId, "manual_bill_pay", bill(accountId), {
        idempotencyKey: key,
        now: NOW,
      });
      expect(again.id).toBe(first.id);
      await expect(
        planAction(userId, "manual_bill_pay", bill(accountId), {
          idempotencyKey: crypto.randomUUID(),
          now: NOW,
        }),
      ).rejects.toMatchObject({ reason: "check_failed" });
      await answerAction(userId, first.id, { yes: false }, { now: NOW });
      await expect(
        planAction(userId, "manual_bill_pay", bill(accountId), {
          idempotencyKey: crypto.randomUUID(),
          now: NOW,
        }),
      ).resolves.toBeDefined();
    });

    it("checks autopay again at the yes", async () => {
      flags.real.manual_bill_pay = true;
      const { userId, accountId } = await withChecking();
      await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
      const planned = await planAction(userId, "manual_bill_pay", bill(accountId), {
        idempotencyKey: crypto.randomUUID(),
        now: NOW,
      });
      await bankLine(userId, accountId, "2026-11-01", 8412, "CON EDISON AUTOPAY");
      await expect(
        answerAction(
          userId,
          planned.id,
          { yes: true, amountCents: 8412, fingerprint: planned.fingerprint },
          { now: NOW },
        ),
      ).rejects.toMatchObject({ reason: "check_failed" });
      expect(
        (
          await scopedFor(userId, db).connectorActions.findFirstOrThrow({
            where: { id: planned.id },
          })
        ).status,
      ).toBe("awaiting_yes");
    });

    it("lets one bank line settle one payment, across nights", async () => {
      flags.real.manual_bill_pay = true;
      const { userId, accountId } = await withChecking();
      await grantConsent(userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
      const a = await approved(userId, bill(accountId, { dueOn: "2026-11-20" }));
      const b = await approved(userId, bill(accountId, { dueOn: "2026-11-23" }));
      await bankLine(userId, accountId, "2026-11-18", 8412, "CON EDISON PAYMENT");
      expect(await settleManualPayments(userId, { now: LATER })).toBe(1);
      expect(await settleManualPayments(userId, { now: LATER })).toBe(0);
      const statuses = await system().connectorAction.findMany({
        where: { id: { in: [a.id, b.id] } },
        select: { status: true },
      });
      expect(statuses.map((s) => s.status).sort()).toEqual(["handed_off", "succeeded"]);
    });
  });

  it("never settles from someone else's transactions", async () => {
    flags.real.manual_bill_pay = true;
    const payer = await withChecking();
    const other = await withChecking();
    await grantConsent(payer.userId, "manual_bill_pay", ["prefill_payments"], { now: NOW });
    const planned = await planAction(payer.userId, "manual_bill_pay", bill(payer.accountId), {
      idempotencyKey: crypto.randomUUID(),
      now: NOW,
    });
    await answerAction(
      payer.userId,
      planned.id,
      { yes: true, amountCents: 8412, fingerprint: planned.fingerprint },
      { now: NOW },
    );
    await executeAction(payer.userId, planned.id, { now: LATER });
    await bankLine(other.userId, other.accountId, "2026-11-18", 8412, "CON EDISON PAYMENT");
    expect(await settleManualPayments(payer.userId, { now: LATER })).toBe(0);
    expect(await settleManualPayments(other.userId, { now: LATER })).toBe(0);
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    expect(row.status).toBe("handed_off");
  });
});
