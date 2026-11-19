import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Pinwheel's sandbox twin against a real, migrated Postgres: a sample person who allows it gets the
// health plan on Pinwheel's documented pay stub as a found benefit through Walmart, for them to
// confirm, not twice; a real person reaches neither registration.

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
import { systemDb } from "@/lib/system-db";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { realPerson, removePeople, samplePerson } from "../__fixtures__/people";
import { ConsentError, grantConsent } from "../consent";
import { readConnector } from "../read";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-19T15:00:00Z");
const network = vi.fn(() => {
  throw new Error("no network in tests");
});
const benefits = (userId: string) =>
  systemDb("Test: reads what Pinwheel found", db).employerBenefit.findMany({
    where: { userId },
    select: {
      employer: true,
      kind: true,
      label: true,
      perPayCents: true,
      payFrequency: true,
      status: true,
      source: true,
    },
  });
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

describe.runIf(url)("Pinwheel's pay stubs, sandbox", () => {
  const people: string[] = [];
  let sample: string;
  let real: string;

  beforeAll(async () => {
    stubTestKeys();
    sample = await samplePerson(db);
    real = await realPerson(db);
    people.push(sample, real);
  });
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubGlobal("fetch", network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
  });

  it("finds the health plan on a sample person's pay stub, for them to confirm, once", async () => {
    session.userId = sample;
    await allowConnector(form({ connectorId: "sandbox_pinwheel_payroll", scope: "read_pay" }));
    expect(await benefits(sample)).toEqual([
      {
        employer: "Walmart",
        kind: "health",
        label: "Aetna PPO",
        perPayCents: 7_012,
        payFrequency: "biweekly",
        status: "found",
        source: "paystub",
      },
    ]);
    const again = await readConnector(sample, "sandbox_pinwheel_payroll", { client: db, now: NOW });
    expect(again.saved).toBe(0);
    expect(again.note).toBe("Your pay stub from Walmart shows no new benefits through work.");
    expect(await benefits(sample)).toHaveLength(1);
  });

  it("never reaches a real person", async () => {
    for (const id of ["pinwheel_payroll", "sandbox_pinwheel_payroll"]) {
      await expect(grantConsent(real, id, ["read_pay"], { client: db })).rejects.toBeInstanceOf(
        ConsentError,
      );
    }
    expect(await benefits(real)).toEqual([]);
  });
});
