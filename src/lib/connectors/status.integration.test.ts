import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// /admin/connectors (section C5) against a real, migrated Postgres: who each connector is open to by
// the app's own locks, key names set or missing with no value anywhere, people connected, last read.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { db } from "@/lib/db";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { removePeople, samplePerson } from "./__fixtures__/people";
import { grantConsent } from "./consent";
import { readConnector } from "./read";
import { connectorStatus } from "./status";

const url = process.env.TEST_DATABASE_URL;
const SECRET = "never-shown-key-value";

describe.runIf(url)("the admin's connector status", () => {
  const people: string[] = [];
  beforeAll(async () => {
    stubTestKeys();
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    const person = await samplePerson(db);
    people.push(person);
    await grantConsent(person, "sandbox_canopy_connect", ["read_policies"], { client: db });
    await readConnector(person, "sandbox_canopy_connect", { client: db });
  });
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });

  it("says who each is open to, by the app's own locks", async () => {
    const rows = await connectorStatus({ client: db, env: { CONNECTORS: "1" } });
    const canopy = rows.find((r) => r.id === "canopy_connect")!;
    const twin = rows.find((r) => r.id === "sandbox_canopy_connect")!;
    expect([canopy.realPeople, canopy.samplePeople]).toEqual(["switched_off", "real_for_real"]);
    expect([twin.realPeople, twin.samplePeople]).toEqual(["sandbox_for_samples", null]);
    const off = await connectorStatus({ client: db, env: {} });
    expect(off.every((r) => r.realPeople === "off" && r.samplePeople === "off")).toBe(true);
  });

  it("counts people connected and the last read", async () => {
    const twin = (await connectorStatus({ client: db, env: { CONNECTORS: "1" } })).find(
      (r) => r.id === "sandbox_canopy_connect",
    )!;
    expect(twin.connected).toBeGreaterThanOrEqual(1);
    expect(twin.lastRead).toBeInstanceOf(Date);
  });

  it("names its keys set or missing, and carries no value", async () => {
    const rows = await connectorStatus({
      client: db,
      env: { CONNECTORS: "1", METHOD_API_KEY: SECRET, SNAPTRADE_CLIENT_ID: SECRET },
    });
    expect(rows.find((r) => r.id === "method_liabilities")!.keys).toEqual([
      { name: "METHOD_API_KEY", set: true },
      { name: "METHOD_WEBHOOK_HMAC_SECRET", set: false },
    ]);
    expect(rows.find((r) => r.id === "credit_upload")!.keys).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });
});
