import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { detectFor } from "./suggestions";

// Loans QA against a real database: a real account (imported from CSV, no demo bank) with a
// $6,000 card and no rate for it gets facts only. No loan picked from the stand-in catalog
// (consolidation, what you could borrow), and "should I consolidate?" asks for the rate rather
// than saying there's no debt.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("loans on a real account", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `loans-real-${crypto.randomUUID()}@example.com` } })
    ).id;
    const account = (data: { name: string; type: string; subtype: string; cents: number }) =>
      client.account.create({
        data: {
          userId,
          source: "csv",
          name: data.name,
          type: data.type,
          subtype: data.subtype,
          currentBalanceCents: data.cents,
        },
      });
    const card = await account({
      name: "Card",
      type: "credit",
      subtype: "credit card",
      cents: 600_000,
    });
    const checking = await account({
      name: "Checking",
      type: "depository",
      subtype: "checking",
      cents: 300_000,
    });
    for (let m = 0; m < 6; m++) {
      const day = (d: number) => new Date(Date.UTC(2026, 4 + m, d));
      for (const t of [
        {
          accountId: checking.id,
          date: day(1),
          amountCents: -450_000,
          description: "ACME PAYROLL",
          pfcDetailed: "INCOME_SALARY",
        },
        {
          accountId: card.id,
          date: day(20),
          amountCents: 13_000,
          description: "INTEREST CHARGE",
          pfcDetailed: "BANK_FEES_INTEREST_CHARGE",
        },
      ]) {
        await client.transaction.create({ data: { ...t, userId, source: "csv" } });
      }
    }
  });
  afterAll(async () => {
    await client.user.delete({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("brings no loan priced from the stand-in catalog, but still the card's interest", async () => {
    const { suggestions, advice } = await detectFor(userId, { client, now: NOW });
    expect(advice).toBe(false);
    const topics = suggestions.map((s) => s.topic);
    expect(topics).not.toContain("consolidation");
    expect(topics).not.toContain("borrowing_power");
    expect(topics).toContain("card_interest");
  });

  it("asks for the rate when asked to consolidate, with no pick, label or confidence", async () => {
    const { reply } = await sendToJane(userId, "should I consolidate", { client, now: NOW });
    expect(reply.body).toBe(
      "You owe $6,000.00 on Card, but I don't have its rate. Tell me the rate (it's on the statement, as the purchase APR) and I'll work this out with your numbers.",
    );
    expect(parseRefs(reply.refs).advice).toBeFalsy();
  });
});
