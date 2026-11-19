import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SnapTrade's sandbox twin against a real, migrated Postgres: a sample person who allows it gets
// SnapTrade's documented brokerage account and its stock and fund as an investment account with
// holdings, read again in place, and revoking takes them back; a real person reaches neither
// registration, nor the Connection Portal.

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
import { realPerson, removePeople, samplePerson } from "../__fixtures__/people";
import { ConsentError, grantConsent } from "../consent";
import { readConnector } from "../read";
import { snaptradeConnectLink } from "./link";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-19T15:00:00Z");
const network = vi.fn(() => {
  throw new Error("no network in tests");
});
const fromSnaptrade = (userId: string) =>
  systemDb("Test: reads what SnapTrade saved", db).account.findMany({
    where: { userId, source: "snaptrade" },
    select: {
      type: true,
      currentBalanceCents: true,
      holdings: {
        select: { valueCents: true, security: { select: { ticker: true, type: true } } },
        orderBy: { valueCents: "asc" },
      },
    },
  });
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

describe.runIf(url)("SnapTrade's holdings, sandbox", () => {
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

  it("brings a sample person's brokerage account and its holdings in, like Plaid Investments'", async () => {
    session.userId = sample;
    await allowConnector(
      form({ connectorId: "sandbox_snaptrade_holdings", scope: "read_holdings" }),
    );
    const [account] = await fromSnaptrade(sample);
    expect(account).toEqual({
      type: "investment",
      currentBalanceCents: 259_246,
      holdings: [
        { valueCents: 129_623, security: { ticker: "AAPL", type: "equity" } },
        { valueCents: 129_623, security: { ticker: "VFIAX", type: "mutual fund" } },
      ],
    });
    // Reading again updates in place.
    await readConnector(sample, "sandbox_snaptrade_holdings", { client: db, now: NOW });
    expect(await fromSnaptrade(sample)).toHaveLength(1);
  });

  it("takes them back when the person revokes the connection", async () => {
    session.userId = sample;
    await revokeConnector(form({ connectorId: "sandbox_snaptrade_holdings" }));
    expect(await fromSnaptrade(sample)).toEqual([]);
    expect(
      await systemDb("Test: reads what SnapTrade saved", db).holding.count({
        where: { userId: sample, account: { source: "snaptrade" } },
      }),
    ).toBe(0);
  });

  it("never reaches a real person, nor gives anyone a Connection Portal link", async () => {
    for (const id of ["snaptrade_holdings", "sandbox_snaptrade_holdings"]) {
      await expect(
        grantConsent(real, id, ["read_holdings"], { client: db }),
      ).rejects.toBeInstanceOf(ConsentError);
    }
    const api = {
      registerUser: vi.fn(),
      connectLink: vi.fn(),
      accounts: vi.fn(),
      positions: vi.fn(),
    };
    for (const person of [real, sample]) {
      await expect(
        snaptradeConnectLink(person, { client: db, now: NOW, api }),
      ).rejects.toBeInstanceOf(ConsentError);
    }
    expect(api.registerUser).not.toHaveBeenCalled();
  });
});
