import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { listDeadlines, openEnrollmentDeadlines } from "@/lib/deadlines";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { loadHousehold } from "./household";
import { EMPTY_POLICY_INPUT, addPolicy } from "./policies";
import { loadInsurance } from "./profile";
import { requestQuotes } from "./quotes";
import { shopNow } from "./shop";

// Every kind of cover against a real, migrated Postgres (spec step 149): signals read from
// the accounts, health plans compared on a year's total cost, open enrollment as deadlines,
// and "do I need umbrella insurance?" answered from the numbers.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("every kind of cover against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person({ demo }: { demo: boolean }) {
    const user = await client.user.create({
      data: { email: `ins-every-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (demo) {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: "v1:unused",
        },
      });
    }
    const checking = await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 2_000_000,
      },
    });
    const tx = (date: string, amountCents: number, pfcPrimary: string, pfcDetailed: string) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description: pfcDetailed,
          pfcPrimary,
          pfcDetailed,
        },
      });
    await tx("2026-10-15", -250_000, "INCOME", "INCOME_SALARY");
    await tx("2026-09-01", 60_000, "MEDICAL", "MEDICAL_PRIMARY_CARE");
    await tx("2026-10-01", 180_000, "TRAVEL", "TRAVEL_FLIGHTS");
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("reads income, assets, trips and care from the accounts, and finds those gaps", async () => {
    const me = await person({ demo: false });
    const household = await loadHousehold(me, { client, now: NOW });
    expect(household.signals).toEqual({
      paycheck: true,
      assetsCents: 2_000_000,
      travelCents: 180_000,
      medicalCents: 60_000,
    });
    const { gaps } = await loadInsurance(me, { client, now: NOW });
    expect(gaps.map((g) => g.key)).toEqual(["health", "disability", "travel"]);
  });

  it("compares health plans on a year's cost with the person's usual care", async () => {
    const me = await person({ demo: true });
    const policyId = await addPolicy(
      me,
      {
        ...EMPTY_POLICY_INPUT,
        kind: "health",
        carrier: "Oldcare",
        premium: "600",
        premiumFrequency: "monthly",
        deductible: "5000",
        coverage: { outOfPocketMax: "9000", coinsurance: "30" },
      },
      { client },
    );
    const result = await requestQuotes(me, policyId, { client, now: NOW });
    if (result.kind !== "quotes") throw new Error("expected quotes");
    // $600 of care: all under every deductible.
    expect(result.currentTotalCents).toBe(720_000 + 60_000);
    expect(result.quotes.map((q) => [q.plan, q.expectedCostCents])).toEqual([
      ["Bluepeak Bronze (demo)", 384_000 + 60_000],
      ["Bluepeak Silver (demo)", 516_000 + 60_000],
      ["Lighthouse Silver (demo)", 540_000 + 60_000],
      ["Lighthouse Gold (demo)", 672_000 + 60_000],
    ]);
    const shop = await shopNow(me, policyId, { client, now: NOW });
    // Little care a year: the lowest premium wins on total cost too.
    expect(shop?.pick?.plan).toBe("Bluepeak Bronze (demo)");
    expect(shop?.savingCents).toBe(780_000 - 444_000);
    const later = new Date(NOW.getTime() + 60_000);
    const { reply } = await sendToJane(me, "compare health plans", { client, now: later });
    expect(reply.body.split("\n")[0]).toBe(
      "I found a health plan that would cost $3,360.00 less a year with your usual care: Bluepeak Bronze (demo), at $320.00 a month.",
    );
    const tool = JSON.parse(
      (await runChatTool(me, "insurance_quotes", {}, { client, now: NOW })).content,
    );
    expect(tool.policies[0].quotes[0]).toMatchObject({
      plan: "Bluepeak Bronze (demo)",
      aYearWithUsualCare: "$4,440.00",
    });
  });

  it("puts open enrollment on the deadlines for people with a health plan", async () => {
    const me = await person({ demo: false });
    expect(await openEnrollmentDeadlines(me, { client, now: NOW })).toEqual([]);
    await addPolicy(me, { ...EMPTY_POLICY_INPUT, kind: "health", carrier: "Oldcare" }, { client });
    const deadlines = (await listDeadlines(me, { client, now: NOW })).filter((d) =>
      d.key.startsWith("open-enrollment:"),
    );
    expect(deadlines.map((d) => [d.date, d.title])).toEqual([
      ["2026-11-01", "Marketplace health plans open for next year"],
      ["2027-01-15", "Last day to pick a marketplace health plan"],
    ]);
  });

  it("answers do I need umbrella insurance from their numbers", async () => {
    const me = await person({ demo: false });
    const { reply } = await sendToJane(me, "do I need umbrella insurance", { client, now: NOW });
    expect(reply.body).toBe(
      "An umbrella policy pays above your car and home liability limits. It usually matters once what someone has is worth more than $500,000.00; by your balances and values, yours is about $20,000.00.",
    );
  });
});
