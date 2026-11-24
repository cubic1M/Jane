import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Review of #2245: taking a plan back (Revert on a card's yes) must never reach for a plan that has
// started running. The cancel is one conditional write on the plan still waiting or in its hold; a
// plan that moved on to the partner in between is left alone, and the partner is never asked.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { fakeSandbox } from "./__fixtures__/connectors";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { grantConsent } from "./consent";
import { cancelAction, planAction } from "./pipeline";
import { useConnectorsForTests } from "./registry";

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date(Date.now() - 60 * 60 * 1000);
const system = () => systemDb("Test: reads what cancelAction wrote", db);

describe.runIf(url)("cancelling a plan only before it reaches a partner", () => {
  const people: string[] = [];
  const fake = fakeSandbox({ id: "fake_other", movesMoney: false });
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("CONNECTORS_KILLED", "");
    useConnectorsForTests([fake.connector]);
  });
  afterAll(async () => {
    useConnectorsForTests(null);
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });

  async function plan() {
    const userId = await samplePerson(db);
    people.push(userId);
    await grantConsent(userId, "fake_other", ["pay_bills"], { now: T0 });
    const planned = await planAction(
      userId,
      "fake_other",
      { payee: "Con Edison", amountCents: 5000 },
      { idempotencyKey: "finding:abc", now: T0 },
    );
    return { userId, id: planned.id };
  }

  it("cancels a waiting plan and moves its key in the same write", async () => {
    const { userId, id } = await plan();
    expect(await cancelAction(userId, id, { beforePartner: { idempotencyKey: "freed:1" } })).toBe(
      true,
    );
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "cancelled", idempotencyKey: "freed:1" });
  });

  it("leaves a plan that reached the partner alone, and never asks the partner", async () => {
    const { userId, id } = await plan();
    // It started running after the caller looked: the partner has it, and it can still be taken back.
    await system().connectorAction.update({
      where: { id },
      data: {
        status: "partner_pending",
        externalRef: "ext_1",
        cancelUntil: new Date(Date.now() + 3_600_000),
      },
    });
    const calls = fake.calls.cancel.length;

    expect(await cancelAction(userId, id, { beforePartner: { idempotencyKey: "freed:2" } })).toBe(
      false,
    );

    expect(fake.calls.cancel).toHaveLength(calls);
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "partner_pending", idempotencyKey: "finding:abc" });
  });
});
