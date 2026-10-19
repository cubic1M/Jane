import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { encrypt } from "@/lib/crypto";
import { linkDemoBank } from "@/lib/plaid/demo";
import { adviceMode } from "./advice-mode";

// Spec step 98 against a real, migrated Postgres: advice only for people whose data is all
// the demo bank, in production only with DEMO_ADVICE=1. A real account never gets it.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("adviceMode", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
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
    vi.stubEnv("DEMO_ADVICE", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_ADVICE", "");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is on for someone whose data is only the demo bank", async () => {
    const userId = await withDemoBank("advice-demo");
    expect(await adviceMode(userId, { client })).toBe(true);
  });

  it("is off for someone with no data, a real bank or a CSV import", async () => {
    expect(await adviceMode(await person("advice-empty"), { client })).toBe(false);
    const real = await person("advice-real");
    await addRealBank(real);
    expect(await adviceMode(real, { client })).toBe(false);
    const csv = await person("advice-csv");
    await addCsvAccount(csv);
    expect(await adviceMode(csv, { client })).toBe(false);
  });

  it("is off as soon as real data sits next to the demo bank", async () => {
    const mixedBank = await withDemoBank("advice-mixed-bank");
    await addRealBank(mixedBank);
    expect(await adviceMode(mixedBank, { client })).toBe(false);
    const mixedCsv = await withDemoBank("advice-mixed-csv");
    await addCsvAccount(mixedCsv);
    expect(await adviceMode(mixedCsv, { client })).toBe(false);
  });

  it("needs DEMO_ADVICE=1 in production, and even then never for a real account", async () => {
    const demo = await withDemoBank("advice-prod-demo");
    const real = await person("advice-prod-real");
    await addRealBank(real);
    vi.stubEnv("NODE_ENV", "production");
    expect(await adviceMode(demo, { client })).toBe(false);
    vi.stubEnv("DEMO_ADVICE", "1");
    expect(await adviceMode(demo, { client })).toBe(true);
    expect(await adviceMode(real, { client })).toBe(false);
  });

  it("checks only the person it's asked about", async () => {
    const demo = await withDemoBank("advice-scope-demo");
    const real = await person("advice-scope-real");
    await addRealBank(real);
    expect(await adviceMode(demo, { client })).toBe(true);
    expect(await adviceMode(real, { client })).toBe(false);
  });

  it("keeps advice for real accounts switched off in code", () => {
    expect(REAL_ACCOUNT_ADVICE).toBe(false);
  });
});
