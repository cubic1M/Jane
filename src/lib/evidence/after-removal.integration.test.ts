import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { refreshAfterRemoval } from "@/lib/import/background";
import { loadPopupStack } from "@/lib/jane-agent/popup-stack";
import { AS_THEY_COME } from "@/lib/jane-agent/preferences";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { linkDemoBank } from "@/lib/plaid/demo";
import { removePlaidItem } from "@/lib/plaid/remove";
import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";

// The night debugger's repro (10-30), against a real, migrated Postgres: someone with their own
// checking account also links the demo bank, Jane brings up suggestions, then the demo bank is
// disconnected. A disconnect only re-ran detection, so "What matters now" and the dock kept the
// demo bank's cash and its Comcast and Verizon bills for up to a day. Now everything is worked out
// again (refreshAfterRemoval), and each suggestion card says what its suggestion says now.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const opened = new Date(NOW.getTime() + 60_000);
// The demo bank's own: its bills, its car and home, its insurers.
const DEMO = /Comcast|Verizon|Xfinity|Demo car|Demo home|GEICO|Asurion|West Marine|Apple/;

describe.runIf(url)("after a bank is disconnected, Jane's cards are worked out again", () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `after-removal-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.janePreference.create({
      data: { userId, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
    // Their own checking, uploaded: a paycheck and groceries for half a year.
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Chase Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 1_944_751,
      },
    });
    await client.transaction.createMany({
      data: Array.from({ length: 6 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 3 + i, 15));
        return [
          {
            userId,
            accountId: account.id,
            source: "csv" as const,
            date,
            amountCents: -420_000,
            description: "ACME CORP PAYROLL",
            pfcPrimary: "INCOME",
            pfcDetailed: "INCOME_WAGES",
          },
          {
            userId,
            accountId: account.id,
            source: "csv" as const,
            date,
            amountCents: 31_250,
            description: "TRADER JOE'S #552",
            pfcPrimary: "FOOD_AND_DRINK",
            pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
          },
        ];
      }).flat(),
    });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("says nothing from the demo bank once it is gone, and keeps nothing it seeded", async () => {
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    await scanSuggestions(userId, { client, now: NOW });
    await runJaneAgent(userId, { client, now: NOW, trigger: "open" });
    const before = await loadPopupStack(userId, { client, now: opened });
    expect(before.map((c) => c.body).join("\n")).toMatch(DEMO);

    await removePlaidItem(userId, itemId, "user_disconnected", { client, api: plaid });
    await refreshAfterRemoval(userId, { client, now: NOW });

    const after = await loadPopupStack(userId, { client, now: opened });
    expect(after.map((c) => c.body).join("\n")).not.toMatch(DEMO);
    // What it seeded is gone too: its insurance, its home and car.
    expect(await client.insurancePolicy.count({ where: { userId } })).toBe(0);
    expect(await client.ownedAsset.count({ where: { userId } })).toBe(0);
    expect(await client.coverChange.count({ where: { userId, status: "prepared" } })).toBe(0);
  });
});
