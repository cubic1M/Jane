import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Who a letter is from and to (security review, round 46): the person's own name and the company's
// documented address, whatever the request says. A chat, a message or a caller can't have Jane mail
// a letter in someone else's name or to an address of its choosing.

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
import { removePeople, samplePerson } from "../__fixtures__/people";
import { grantConsent } from "../consent";
import { planAction } from "../pipeline";

const url = process.env.TEST_DATABASE_URL;
const system = () => systemDb("Test: makes people who send letters", db);
const LA_FITNESS = "P.O. Box 54170, Irvine, CA 92619";

describe.runIf(url)("a letter's sender and recipient", () => {
  const people: string[] = [];
  beforeAll(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64")));
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
  });

  async function person(name: string | null) {
    const userId = await samplePerson(db);
    people.push(userId);
    if (name) await system().user.update({ where: { id: userId }, data: { name } });
    await grantConsent(userId, "sandbox_letters", ["cancel_subscriptions", "contact_companies"]);
    return userId;
  }
  const letter = (userId: string, request: Record<string, string>) =>
    planAction(userId, "sandbox_letters", request, { idempotencyKey: crypto.randomUUID() });

  it("signs with the person's own name and mails to the company's documented address", async () => {
    const userId = await person("Alex Sample");
    const planned = await letter(userId, {
      company: "la fitness",
      toAddress: "1 Attacker Way, Anytown, CA 90000",
      fromName: "Somebody Else",
    });
    expect(planned.steps).toEqual(
      expect.arrayContaining([
        { label: "To", value: `LA Fitness, ${LA_FITNESS}` },
        { label: "From", value: "Alex Sample" },
      ]),
    );
    const row = await system().connectorAction.findUniqueOrThrow({ where: { id: planned.id } });
    expect(row.details).toMatchObject({ toAddress: LA_FITNESS, fromName: "Alex Sample" });
  });

  it("refuses a company Jane doesn't know takes a letter, and a person with no name", async () => {
    const named = await person("Alex Sample");
    await expect(
      letter(named, { company: "Acme Gym", toAddress: "1 Attacker Way", fromName: "Alex Sample" }),
    ).rejects.toMatchObject({ reason: "check_failed" });
    const unnamed = await person(null);
    await expect(
      letter(unnamed, { company: "LA Fitness", toAddress: LA_FITNESS, fromName: "Alex Sample" }),
    ).rejects.toMatchObject({ reason: "check_failed" });
  });
});
