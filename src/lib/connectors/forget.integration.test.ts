import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Section C2: revoking a connection in Settings removes what it brought in, and the page says when it
// was last read. Against a real, migrated Postgres; the sandbox twins call nobody.

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
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { connectionsView } from "./consent";
import { allConnectors } from "./registry";

const url = process.env.TEST_DATABASE_URL;
const sys = () => systemDb("Test: what revoking removes", db);
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};
const forgotten = (userId: string) =>
  sys().auditLog.count({ where: { event: "connector_data_forgotten", targetId: userId } });

// Readers that keep nothing of their own to remove: accounts tied to their credential go with it
// (accounts.connector_credential_id cascades), or they read into memory only.
const NOTHING_TO_FORGET: Record<string, string> = {
  method_liabilities: "accounts, removed by the credential cascade",
  sandbox_method_liabilities: "accounts, removed by the credential cascade",
  snaptrade_holdings: "accounts and their holdings, removed by the credential cascade",
  sandbox_snaptrade_holdings: "accounts and their holdings, removed by the credential cascade",
  sandbox_chart_transcripts: "reads transcripts for the page, stores none",
};

describe("every reader decides what revoking removes", () => {
  it("has a forget step, or a reason it keeps nothing", () => {
    for (const c of allConnectors().filter((c) => c.read)) {
      expect(Boolean(c.forget) || c.id in NOTHING_TO_FORGET, c.id).toBe(true);
    }
  });
});

describe.runIf(url)("revoking removes what a connection brought in", () => {
  const people: string[] = [];
  beforeAll(() => stubTestKeys());
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("no network"))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("takes back Canopy's policies, and shows when it was last read until then", async () => {
    session.userId = await samplePerson(db);
    people.push(session.userId);
    await allowConnector(form({ connectorId: "sandbox_canopy_connect", scope: "read_policies" }));
    expect(
      await sys().insurancePolicy.count({ where: { userId: session.userId, source: "canopy" } }),
    ).toBeGreaterThan(0);
    const { current } = await connectionsView(session.userId, { client: db });
    expect(
      current.find((r) => r.connectorId === "sandbox_canopy_connect")?.lastReadAt,
    ).toBeInstanceOf(Date);
    await revokeConnector(form({ connectorId: "sandbox_canopy_connect" }));
    expect(
      await sys().insurancePolicy.count({ where: { userId: session.userId, source: "canopy" } }),
    ).toBe(0);
    expect(await forgotten(session.userId)).toBe(1);
  });

  it("takes back the benefits Pinwheel found, and keeps the ones the person confirmed", async () => {
    session.userId = await samplePerson(db);
    people.push(session.userId);
    await allowConnector(form({ connectorId: "sandbox_pinwheel_payroll", scope: "read_pay" }));
    await sys().employerBenefit.create({
      data: {
        userId: session.userId,
        employer: "Walmart",
        kind: "dental",
        label: "Delta Dental",
        perPayCents: 1_000,
        payFrequency: "biweekly",
        status: "confirmed",
        source: "paystub",
      },
    });
    await revokeConnector(form({ connectorId: "sandbox_pinwheel_payroll" }));
    const left = await sys().employerBenefit.findMany({ where: { userId: session.userId } });
    expect(left.map((b) => [b.label, b.status])).toEqual([["Delta Dental", "confirmed"]]);
  });
});
