import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadBusinessStructure } from "@/lib/business-structure";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadSelfEmployed } from "@/lib/self-employed";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { sendToJane } from "./typing";

// Taxes QA (2026-10-22): Jo's shop sales come from her card processor as "SQUARE DEPOSIT", other
// income. The estimate, the self-employed and business pages and the chat all counted nothing,
// while the detectors said she owed estimated tax. Now her sales are business income, at the
// detectors' profit share until she tags her business expenses.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("a shop owner's taxes against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `qa-owner-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: "owner" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("counts her card sales as business income, at the assumed profit share, and says so", async () => {
    const v = await loadTaxEstimate(userId, { client, now: NOW });
    expect(v.input.income.selfEmploymentCents).toBeGreaterThan(5_000_000);
    expect(v.estimate.totalTaxCents).toBeGreaterThan(1_000_000);
    expect(v.assumptions.join(" ")).toMatch(
      /Your card sales so far \(\$[\d,.]+\) are business income\. I've counted 15% of them as profit/,
    );
    expect((await loadSelfEmployed(userId, { client, now: NOW })).active).toBe(true);
    expect((await loadBusinessStructure(userId, { client, now: NOW })).structure).not.toBeNull();
  });

  it("answers as her business, not as an employee", async () => {
    const owe = await sendToJane(userId, "how much will I owe", { client, now: NOW });
    expect(owe.reply.body).toMatch(/^Federal: you're on course to owe \$[\d,]+\./);
    const office = await sendToJane(userId, "can I deduct my home office", { client, now: NOW });
    expect(office.reply.body).not.toContain("If you're an employee");
    const withholding = await sendToJane(userId, "am I withholding enough", { client, now: NOW });
    expect(withholding.reply.body).toMatch(
      /^Nobody withholds tax from self-employment income, so you pay it yourself in quarterly estimated payments\./,
    );
    const corp = await sendToJane(userId, "should I be an s corp", { client, now: NOW });
    expect(corp.reply.body).toMatch(/^Here is where your business taxes stand\./);
  });
});
