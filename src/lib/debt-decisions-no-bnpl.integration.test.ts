import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// Someone with no buy now, pay later plan: loadBnpl's forecast is empty, as it is for them.
vi.mock("@/lib/bnpl", () => ({
  loadBnpl: vi.fn(async () => ({
    available: false,
    asOf: "2026-10-18",
    plans: [],
    installments: [],
    missing: [],
    checkingCents: null,
    forecastDays: [],
  })),
}));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { overdraft } from "@/planning/debt-decisions";
import { loadDecisionInput } from "./debt-decisions";

// Night QA 10-30: an overdrawn student with no buy now, pay later plan asked "am I overdrawn"
// and heard "I can't see a checking account to forecast", while the safe-to-spend answer read
// that same checking account. The overdraft forecast is the checking account's own.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the overdraft answer without a buy now, pay later plan", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `decisions-nobnpl-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: "renter" });
    await syncItem(itemId, { client, api: {} as PlaidApi, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("forecasts the checking account and answers yes or no", async () => {
    const input = await loadDecisionInput(userId, { client, now: NOW });
    expect(input.forecast?.lowest).not.toBeNull();
    expect(overdraft(input).sentences[0]).toMatch(/^(?:No|Yes)\b/);
  });
});
