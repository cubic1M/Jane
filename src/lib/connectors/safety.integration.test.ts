import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The safety rails, held in code and checked against a real, migrated Postgres. The flags that are
// constants in code (REAL_CONNECTORS, REAL_MONEY_MOVEMENT) are turned on here only, to show what
// each one guards; the registry test checks they're off in the code itself.
//
// 1. A real account never moves money while any flag is off; with all on, only after their yes on
//    that exact action and amount.
// 2. A trial person never reaches a real connector, even with every flag on.
// 3. Each action runs once, however many taps and runners arrive together.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
const flags = vi.hoisted(() => ({ real: {} as Record<string, boolean>, money: false }));
vi.mock("@/config/connectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/connectors")>()),
  REAL_CONNECTORS: flags.real,
}));
vi.mock("@/config/money-movement", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/money-movement")>();
  return {
    ...original,
    get REAL_MONEY_MOVEMENT() {
      return flags.money;
    },
  };
});

import { CONNECTOR_HOLD_MINUTES } from "@/config/connectors";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { exportUserData } from "@/lib/data-export";
import { systemDb } from "@/lib/system-db";
import { fakeConnector, fakeSandbox, type FakeCalls } from "./__fixtures__/connectors";
import { realPerson, removePeople, samplePerson, trialPerson } from "./__fixtures__/people";
import { grantConsent } from "./consent";
import { storeCredential } from "./vault";
import {
  ConnectorRefused,
  answerAction,
  executeAction,
  fingerprintOf,
  planAction,
} from "./pipeline";
import { useConnectorsForTests } from "./registry";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: checks what the safety rails let through", db);
const MINUTE = 60 * 1000;
const T0 = new Date(Date.now() - 3 * 24 * 60 * MINUTE);
const afterHold = new Date(T0.getTime() + (CONNECTOR_HOLD_MINUTES.money + 1) * MINUTE);
const BILL = { payee: "Con Edison", amountCents: 8412 };

describe.runIf(url)("the connector safety rails", () => {
  const people: string[] = [];
  let calls: FakeCalls;

  // Every lock open for the fake real connector: env, its switch in code, money in code.
  const allOn = () => {
    vi.stubEnv("CONNECTORS", "1");
    flags.real.fake_bills = true;
    flags.money = true;
  };

  async function person(kind: "real" | "sample" | "trial") {
    const id = await (
      kind === "real" ? realPerson : kind === "sample" ? samplePerson : trialPerson
    )(db);
    people.push(id);
    return id;
  }

  // A real account with consent and an approved bill, made while every lock was open.
  async function approvedBill() {
    allOn();
    const userId = await person("real");
    await grantConsent(userId, "fake_bills", ["pay_bills"], { now: T0 });
    const planned = await planAction(userId, "fake_bills", BILL, {
      idempotencyKey: crypto.randomUUID(),
      now: T0,
    });
    await answerAction(
      userId,
      planned.id,
      { yes: true, amountCents: planned.amountCents, fingerprint: planned.fingerprint },
      { now: T0 },
    );
    return { userId, id: planned.id, planned };
  }

  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 2).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "");
    vi.stubEnv("CONNECTORS_KILLED", "");
    for (const key of Object.keys(flags.real)) delete flags.real[key];
    flags.money = false;
    const fake = fakeConnector();
    calls = fake.calls;
    useConnectorsForTests([fake.connector]);
  });
  afterEach(() => useConnectorsForTests(null));

  describe("1. real money on a real account", () => {
    it("moves only with every lock open", async () => {
      const locks = [
        ["CONNECTORS off", () => vi.stubEnv("CONNECTORS", "")],
        ["its switch off", () => delete flags.real.fake_bills],
        ["REAL_MONEY_MOVEMENT off", () => (flags.money = false)],
        ["KILL_CONNECTORS on", () => vi.stubEnv("KILL_CONNECTORS", "1")],
        ["its id killed", () => vi.stubEnv("CONNECTORS_KILLED", "fake_bills")],
      ] as const;
      for (const [name, close] of locks) {
        const { userId, id } = await approvedBill();
        close();
        await expect(executeAction(userId, id, { now: afterHold }), name).resolves.toBe("refused");
        vi.stubEnv("KILL_CONNECTORS", "");
        vi.stubEnv("CONNECTORS_KILLED", "");
      }
      expect(calls.act).toHaveLength(0);
      const { userId, id } = await approvedBill();
      await expect(executeAction(userId, id, { now: afterHold })).resolves.toBe("partner_pending");
      expect(calls.act).toHaveLength(1);
    });

    it("can't even be planned while any lock in front of it is shut", async () => {
      allOn();
      const userId = await person("real");
      await grantConsent(userId, "fake_bills", ["pay_bills"], { now: T0 });
      vi.stubEnv("CONNECTORS", "");
      await expect(
        planAction(userId, "fake_bills", BILL, { idempotencyKey: "a", now: T0 }),
      ).rejects.toMatchObject({ reason: "off" });
      vi.stubEnv("CONNECTORS", "1");
      delete flags.real.fake_bills;
      await expect(
        planAction(userId, "fake_bills", BILL, { idempotencyKey: "a", now: T0 }),
      ).rejects.toMatchObject({ reason: "switched_off" });
    });

    it("needs the person's yes: never runs on a plan alone", async () => {
      allOn();
      const userId = await person("real");
      await grantConsent(userId, "fake_bills", ["pay_bills"], { now: T0 });
      const planned = await planAction(userId, "fake_bills", BILL, {
        idempotencyKey: crypto.randomUUID(),
        now: T0,
      });
      await expect(executeAction(userId, planned.id, { now: afterHold })).resolves.toBe("skipped");
      // Even forged straight to approved in the database, the yes's amount must be there.
      await system().connectorAction.update({
        where: { id: planned.id },
        data: { status: "approved", runAt: T0, approvedAt: T0 },
      });
      await expect(executeAction(userId, planned.id, { now: afterHold })).resolves.toBe("refused");
      expect(calls.act).toHaveLength(0);
    });

    it("needs that exact amount and action", async () => {
      allOn();
      const userId = await person("real");
      await grantConsent(userId, "fake_bills", ["pay_bills"], { now: T0 });
      const planned = await planAction(userId, "fake_bills", BILL, {
        idempotencyKey: crypto.randomUUID(),
        now: T0,
      });
      const other = fingerprintOf("fake_bills", {
        kind: "pay_bill",
        amountCents: 8412,
        details: { payee: "Someone Else", amountCents: 8412 },
      });
      for (const wrong of [
        { amountCents: 8413, fingerprint: planned.fingerprint },
        { amountCents: 8412, fingerprint: other },
      ]) {
        await expect(
          answerAction(userId, planned.id, { yes: true, ...wrong }, { now: T0 }),
        ).rejects.toThrow(ConnectorRefused);
      }
      // A yes, then the amount raised behind it: refused when it comes to run.
      await answerAction(
        userId,
        planned.id,
        { yes: true, amountCents: planned.amountCents, fingerprint: planned.fingerprint },
        { now: T0 },
      );
      await system().connectorAction.update({
        where: { id: planned.id },
        data: { amountCents: 84_120 },
      });
      await expect(executeAction(userId, planned.id, { now: afterHold })).resolves.toBe("refused");
      expect(calls.act).toHaveLength(0);
    });
  });

  describe("2. trial people", () => {
    it("never reach a real connector, even with every lock open", async () => {
      allOn();
      const trial = await person("trial");
      await expect(grantConsent(trial, "fake_bills", ["pay_bills"])).rejects.toMatchObject({
        reason: "trial",
      });
      await expect(
        planAction(trial, "fake_bills", BILL, { idempotencyKey: "t", now: T0 }),
      ).rejects.toMatchObject({ reason: "trial" });
      // A row forged for them, already approved, with consent: refused at the last check.
      const draft = { kind: "pay_bill", amountCents: 8412, details: BILL };
      await system().connectorConsent.create({
        data: { userId: trial, connectorId: "fake_bills", scopes: ["pay_bills"] },
      });
      const forged = await system().connectorAction.create({
        data: {
          userId: trial,
          connectorId: "fake_bills",
          kind: "pay_bill",
          status: "approved",
          amountCents: 8412,
          approvedCents: 8412,
          approvedAt: T0,
          runAt: T0,
          summary: "Pay",
          steps: [],
          details: BILL,
          fingerprint: fingerprintOf("fake_bills", draft),
          idempotencyKey: "forged",
          expiresAt: afterHold,
        },
      });
      await expect(executeAction(trial, forged.id, { now: afterHold })).resolves.toBe("refused");
      expect(
        (await system().connectorAction.findUniqueOrThrow({ where: { id: forged.id } })).reason,
      ).toBe("trial");
      expect(calls.act).toHaveLength(0);
    });

    it("and sample data never reaches one either", async () => {
      allOn();
      const sample = await person("sample");
      await expect(
        planAction(sample, "fake_bills", BILL, { idempotencyKey: "s", now: T0 }),
      ).rejects.toMatchObject({ reason: "real_for_real" });
    });
  });

  describe("the vault in the person's own export", () => {
    it("lists their consents and actions, never the credential", async () => {
      const { userId } = await approvedBill();
      const secret = "partner-token-0b9e-never-exported";
      await storeCredential(userId, "fake_bills", secret);
      const row = await system().connectorCredential.findFirstOrThrow({ where: { userId } });
      const exported = JSON.stringify(await exportUserData(userId));
      expect(exported).toContain("fake_bills");
      expect(exported).not.toContain(secret);
      expect(exported).not.toContain(row.secretEncrypted);
    });
  });

  describe("4. recommendations wait for a qualified reviewer", () => {
    it("never plan a personalized investment or tax recommendation for a real person", async () => {
      allOn();
      flags.real.fake_advice = true;
      useConnectorsForTests([
        fakeConnector({ id: "fake_advice", recommends: "investment", movesMoney: false }).connector,
        fakeSandbox({ recommends: "tax", movesMoney: false }).connector,
      ]);
      const real = await person("real");
      await grantConsent(real, "fake_advice", ["pay_bills"], { now: T0 });
      await expect(
        planAction(real, "fake_advice", BILL, { idempotencyKey: crypto.randomUUID(), now: T0 }),
      ).rejects.toMatchObject({ reason: "needs_review" });
      // Sample data is nobody's real money: the demo keeps working.
      const sample = await person("sample");
      await grantConsent(sample, "fake_sandbox", ["pay_bills"], { now: T0 });
      await expect(
        planAction(sample, "fake_sandbox", BILL, { idempotencyKey: crypto.randomUUID(), now: T0 }),
      ).resolves.toMatchObject({ status: "awaiting_yes" });
    });
  });

  describe("3. once", () => {
    it("runs one action once under concurrent taps and runners", async () => {
      allOn();
      const userId = await person("real");
      await grantConsent(userId, "fake_bills", ["pay_bills"], { now: T0 });
      const planned = await planAction(userId, "fake_bills", BILL, {
        idempotencyKey: crypto.randomUUID(),
        now: T0,
      });
      const yes = { yes: true as const, amountCents: 8412, fingerprint: planned.fingerprint };
      await Promise.all(
        Array.from({ length: 10 }, () => answerAction(userId, planned.id, yes, { now: T0 })),
      );
      const runs = await Promise.all(
        Array.from({ length: 10 }, () => executeAction(userId, planned.id, { now: afterHold })),
      );
      expect(runs.filter((r) => r !== "skipped")).toEqual(["partner_pending"]);
      expect(calls.act).toHaveLength(1);
      expect(calls.act[0]!.idempotencyKey).toBe(`jane_${planned.id}`);
      const jobs = await system().job.count({
        where: { kind: "connector_execute", payload: { path: ["actionId"], equals: planned.id } },
      });
      expect(jobs).toBe(1);
    });
  });
});
