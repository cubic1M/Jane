import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The one connect flow (section C1) against a real, migrated Postgres: offered in a card only while it
// can be used and isn't connected or turned down; the consent screen says what, from whom and whether
// the partner has a step; a yes without a partner step reads at once, one with a step goes to the
// partner's https page and reads on the way back; "Not now" is never asked again; each is audited.

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
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { fakeSandbox } from "./__fixtures__/connectors";
import { realPerson, removePeople, samplePerson } from "./__fixtures__/people";
import {
  connectOffered,
  connectScreen,
  declineConnect,
  finishConnect,
  startConnect,
} from "./connect";
import { ConsentError, currentScopes } from "./consent";
import { useConnectorsForTests } from "./registry";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-19T15:00:00Z");
const read = vi.fn(async () => ({ saved: 2, note: "2 things read." }));
const partner = vi.fn(async ({ returnUrl }: { returnUrl: string }) => ({
  redirectUrl: `https://partner.example/connect?back=${encodeURIComponent(returnUrl)}`,
}));
const plain = fakeSandbox({
  id: "fake_reader",
  name: "Fake reader",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  movesMoney: false,
  from: "Your fake bank",
  prefill: undefined,
  act: undefined,
  cancel: undefined,
  read,
}).connector;
const withStep = fakeSandbox({
  id: "fake_partner",
  name: "Fake partner",
  capabilities: ["read"],
  scopes: ["read_holdings"],
  movesMoney: false,
  prefill: undefined,
  act: undefined,
  cancel: undefined,
  read,
  connect: partner,
}).connector;
const audits = (userId: string, action: string) =>
  systemDb("Test: reads the connect flow's audit", db).auditLog.count({
    where: { event: action, targetId: userId },
  });

describe.runIf(url)("the one connect flow", () => {
  const people: string[] = [];
  let sample: string;
  let real: string;

  beforeAll(async () => {
    stubTestKeys();
    sample = await samplePerson(db);
    real = await realPerson(db);
    people.push(sample, real);
    useConnectorsForTests([plain, withStep]);
  });
  afterAll(async () => {
    useConnectorsForTests(null);
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
    vi.stubEnv("APP_URL", "https://jane.example");
    read.mockClear();
    partner.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("offers a connector in a card only to whom it's for, and nobody when connectors are off", async () => {
    expect(await connectOffered(sample, "fake_reader", { client: db })).toBe(true);
    expect(await connectOffered(real, "fake_reader", { client: db })).toBe(false);
    vi.stubEnv("CONNECTORS", "");
    expect(await connectOffered(sample, "fake_reader", { client: db })).toBe(false);
  });

  it("says what Jane gets, from whom, and whether the partner has a step", async () => {
    expect(await connectScreen(sample, "fake_reader", { client: db })).toMatchObject({
      name: "Fake reader",
      reads: ["See your accounts and balances"],
      from: "Your fake bank",
      partnerStep: false,
    });
    expect((await connectScreen(sample, "fake_partner", { client: db })).from).toBe("Fake partner");
    await expect(connectScreen(real, "fake_reader", { client: db })).rejects.toBeInstanceOf(
      ConsentError,
    );
  });

  it("reads at once on a yes when there's no partner step, then stops offering it", async () => {
    const start = await startConnect(sample, "fake_reader", {
      client: db,
      now: NOW,
      returnUrl: "/settings/connections/fake_reader/return?from=%2Fhome",
    });
    expect(start).toEqual({ next: "done", read: { saved: 2, note: "2 things read." } });
    expect(await currentScopes(sample, "fake_reader", { client: db })).toEqual(["read_accounts"]);
    expect(await connectOffered(sample, "fake_reader", { client: db })).toBe(false);
    expect(await audits(sample, "connector_connect_started")).toBe(1);
  });

  it("sends the person to the partner's https page with Jane's own way back, and reads on return", async () => {
    const start = await startConnect(sample, "fake_partner", {
      client: db,
      now: NOW,
      returnUrl: "/settings/connections/fake_partner/return?from=%2Finvestments",
    });
    expect(start.next).toBe("partner");
    expect(partner).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl:
          "https://jane.example/settings/connections/fake_partner/return?from=%2Finvestments",
      }),
    );
    expect(read).not.toHaveBeenCalled();
    expect(await finishConnect(sample, "fake_partner", { client: db, now: NOW })).toEqual({
      saved: 2,
      note: "2 things read.",
    });
    expect(await audits(sample, "connector_connect_returned")).toBe(1);
    // Back without a consent (a stale link): nothing read.
    expect(await finishConnect(real, "fake_partner", { client: db, now: NOW })).toBeNull();
  });

  it("never offers it again after a Not now", async () => {
    const other = await samplePerson(db);
    people.push(other);
    expect(await connectOffered(other, "fake_reader", { client: db })).toBe(true);
    await declineConnect(other, "fake_reader", { client: db });
    expect(await connectOffered(other, "fake_reader", { client: db })).toBe(false);
    expect(await audits(other, "connector_connect_declined")).toBe(1);
    // The consent screen still opens from Settings.
    expect((await connectScreen(other, "fake_reader", { client: db })).name).toBe("Fake reader");
  });
});
