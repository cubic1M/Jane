import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Canopy Connect against a real, migrated Postgres: a sample-data person allows the sandbox twin on
// the connections page and gets Canopy's documented policies as their cover, which the renewal
// reshop then picks up; nobody else gets anything.

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

import { allowConnector } from "@/app/settings/connections/actions";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { POLICY_SELECT, toPolicy } from "@/lib/insurance/policies";
import { reshopDue } from "@/lib/insurance/shop";
import { systemDb } from "@/lib/system-db";
import { realPerson, removePeople, samplePerson, trialPerson } from "../__fixtures__/people";
import { ConsentError, grantConsent } from "../consent";
import { ReadRefused, readConnector } from "../read";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T15:00:00Z");
const system = () => systemDb("Test: reads what Canopy saved", db);
const policiesOf = (userId: string) =>
  system().insurancePolicy.findMany({
    where: { userId },
    select: { ...POLICY_SELECT, userId: true },
  });
const network = vi.fn(() => {
  throw new Error("no network in tests");
});
const form = (connectorId: string) => {
  const data = new FormData();
  data.append("connectorId", connectorId);
  data.append("scope", "read_policies");
  return data;
};

describe.runIf(url)("Canopy Connect, read into Jane's insurance", () => {
  const people: string[] = [];
  let sample: string;
  let real: string;
  let trial: string;

  beforeAll(async () => {
    sample = await samplePerson(db);
    real = await realPerson(db);
    trial = await trialPerson(db);
    people.push(sample, real, trial);
  });
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    // The sandbox twin calls nobody: any request fails the test.
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
  });

  it("reads nothing without the person's consent", async () => {
    await expect(
      readConnector(sample, "sandbox_canopy_connect", { client: db, now: NOW }),
    ).rejects.toEqual(new ReadRefused("no_consent"));
    expect(await policiesOf(sample)).toEqual([]);
  });

  it("brings a sample person's policies in on their yes, and the car's renewal is reshopped", async () => {
    session.userId = sample;
    await allowConnector(form("sandbox_canopy_connect"));
    const saved = await policiesOf(sample);
    expect(saved.map((p) => [p.kind, p.carrier, p.source]).sort()).toEqual([
      ["auto", "State Farm", "canopy"],
      ["home", "State Farm", "canopy"],
      ["life", "State Farm", "canopy"],
    ]);
    const car = toPolicy(saved.find((p) => p.kind === "auto")!);
    expect(car.renewalDate).toBe("2026-12-09");
    // The finding it feeds: the car's renewal reshop, 21 days before it renews.
    expect(await reshopDue(sample, car, { client: db, now: NOW })).toMatchObject({
      reason: "renewal",
    });
  });

  it("updates its own policies on the next read, never doubling them", async () => {
    await readConnector(sample, "sandbox_canopy_connect", { client: db, now: NOW });
    expect(await policiesOf(sample)).toHaveLength(3);
  });

  it("never reads Canopy for a real person or a trial person, even with every lock open but its switch", async () => {
    for (const person of [real, trial]) {
      await expect(
        grantConsent(person, "canopy_connect", ["read_policies"]),
      ).rejects.toBeInstanceOf(ConsentError);
      await expect(
        readConnector(person, "canopy_connect", { client: db, now: NOW }),
      ).rejects.toMatchObject({ reason: person === trial ? "trial" : "switched_off" });
      expect(await policiesOf(person)).toEqual([]);
    }
  });

  it("keeps the sandbox twin from a real person", async () => {
    await expect(
      readConnector(real, "sandbox_canopy_connect", { client: db, now: NOW }),
    ).rejects.toMatchObject({ reason: "sandbox_for_samples" });
  });

  it("reaches nobody with CONNECTORS off", async () => {
    vi.stubEnv("CONNECTORS", "");
    await expect(
      readConnector(sample, "sandbox_canopy_connect", { client: db, now: NOW }),
    ).rejects.toMatchObject({ reason: "off" });
  });
});
