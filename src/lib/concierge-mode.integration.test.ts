import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CONCIERGE_ACTIONS } from "@/config/concierge";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { encrypt } from "@/lib/crypto";
import { linkDemoBank } from "@/lib/plaid/demo";
import { conciergeMode } from "./concierge-mode";

// Read-only mode against a real, migrated Postgres: Jane acts for the demo bank and trial
// people only. Anyone with a real bank or a CSV import does it themselves.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("conciergeMode", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(prefix: string, id?: string) {
    const user = await client.user.create({
      data: { ...(id ? { id } : {}), email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  const withDemoBank = async (prefix: string) => {
    const userId = await person(prefix);
    await linkDemoBank(userId, { client });
    return userId;
  };
  const addRealBank = (userId: string) =>
    client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt("access-sandbox-real"),
        institutionName: "First Real Bank",
      },
    });
  const addCsvAccount = (userId: string) =>
    client.account.create({
      data: { userId, source: "csv", name: "Checking (CSV)", type: "depository" },
    });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("keeps acting for real accounts switched off in config, and on for the demo", () => {
    expect(CONCIERGE_ACTIONS.realAccounts).toBe(false);
    expect(CONCIERGE_ACTIONS.demo).toBe(true);
  });

  it("is on for the demo bank and for a trial person", async () => {
    expect(await conciergeMode(await withDemoBank("concierge-demo"), { client })).toBe(true);
    const trial = await person("concierge-trial", `${TRIAL_ID_PREFIX}${crypto.randomUUID()}`);
    expect(await conciergeMode(trial, { client })).toBe(true);
  });

  it("is off for no data, a real bank or a CSV import", async () => {
    expect(await conciergeMode(await person("concierge-empty"), { client })).toBe(false);
    const real = await person("concierge-real");
    await addRealBank(real);
    expect(await conciergeMode(real, { client })).toBe(false);
    const csv = await person("concierge-csv");
    await addCsvAccount(csv);
    expect(await conciergeMode(csv, { client })).toBe(false);
  });

  it("is off as soon as real data sits next to the demo bank", async () => {
    const mixedBank = await withDemoBank("concierge-mixed-bank");
    await addRealBank(mixedBank);
    expect(await conciergeMode(mixedBank, { client })).toBe(false);
    const mixedCsv = await withDemoBank("concierge-mixed-csv");
    await addCsvAccount(mixedCsv);
    expect(await conciergeMode(mixedCsv, { client })).toBe(false);
  });
});
