import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Method's sandbox twin against a real, migrated Postgres: a sample person who allows it gets
// Method's documented card, car loan and federal student loan as debts the Loans pages read, and
// revoking takes them back; a real person never reaches either registration.

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

import { allowConnector, revokeConnector } from "@/app/settings/connections/actions";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { systemDb } from "@/lib/system-db";
import { loadDebts } from "@/lib/debts";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { realPerson, removePeople, samplePerson } from "../__fixtures__/people";
import { ConsentError, grantConsent } from "../consent";
import { readConnector } from "../read";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-19T15:00:00Z");
const network = vi.fn(() => {
  throw new Error("no network in tests");
});
// The debts that came from Method: by their accounts, which say so.
async function fromMethod(userId: string, now: Date) {
  const ids = new Set(
    (
      await systemDb("Test: reads what Method saved", db).account.findMany({
        where: { userId, source: "method" },
        select: { id: true },
      })
    ).map((a) => a.id),
  );
  return (await loadDebts(userId, { client: db, now })).debts.filter(
    (d) => d.accountId !== null && ids.has(d.accountId),
  );
}
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

describe.runIf(url)("Method's loans and cards, sandbox", () => {
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

  it("brings a sample person's card, car loan and federal student loan in as debts", async () => {
    session.userId = sample;
    await allowConnector(form({ connectorId: "sandbox_method_liabilities", scope: "read_credit" }));
    const debts = await fromMethod(sample, NOW);
    expect(debts.map((d) => d.balanceCents).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      80_000, 1_500_000, 12_000_000,
    ]);
    expect(debts.find((d) => d.balanceCents === 1_500_000)?.aprBps).toBe(350);
    // Reading again updates in place.
    await readConnector(sample, "sandbox_method_liabilities", { client: db, now: NOW });
    expect(await fromMethod(sample, new Date(NOW.getTime() + 1))).toHaveLength(3);
  });

  it("takes them back when the person revokes the connection", async () => {
    session.userId = sample;
    await revokeConnector(form({ connectorId: "sandbox_method_liabilities" }));
    expect(await fromMethod(sample, new Date(NOW.getTime() + 2))).toEqual([]);
    expect(
      await systemDb("Test: reads what Method saved", db).account.count({
        where: { userId: sample, source: "method" },
      }),
    ).toBe(0);
  });

  it("never reaches a real person", async () => {
    for (const id of ["method_liabilities", "sandbox_method_liabilities"]) {
      await expect(grantConsent(real, id, ["read_credit"], { client: db })).rejects.toBeInstanceOf(
        ConsentError,
      );
    }
  });
});
