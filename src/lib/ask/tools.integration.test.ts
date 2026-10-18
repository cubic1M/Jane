import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { ASK_TOOLS, runAskTool } from "./tools";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("Ask Jane tools against a real database", () => {
  let client: PrismaClient;
  const ids: Record<"me" | "other", string> = { me: "", other: "" };

  async function person(who: "me" | "other", merchant: string) {
    const user = await client.user.create({
      data: { email: `ask-${who}-${crypto.randomUUID()}@example.com` },
    });
    ids[who] = user.id;
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: `${who} secret account`, type: "credit" },
    });
    const tx = (date: string, amountCents: number, description: string, extra = {}) => ({
      userId: user.id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: `${who}-${date}-${description}`,
      date: day(date),
      amountCents,
      description,
      merchantName: null,
      pfcPrimary: "FOOD_AND_DRINK",
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      categorySource: "rule" as const,
      ...extra,
    });
    await client.transaction.createMany({
      data: [
        ...["2026-08-15", "2026-09-15", "2026-10-15"].map((d) =>
          tx(d, 1_549, `${merchant} STREAMING`, {
            pfcPrimary: "ENTERTAINMENT",
            pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
          }),
        ),
        tx("2026-10-10", 8_000, `${merchant} GROCER 4111 CARD`),
        tx("2026-10-11", 20_000, `ZELLE TO ${who.toUpperCase()} JORDAN RIVERA`, {
          pfcPrimary: "TRANSFER_OUT",
          pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        }),
      ],
    });
    await client.finding.create({
      data: {
        userId: user.id,
        type: "subscription_review",
        key: `merchant:${merchant.toLowerCase()}`,
        title: `Review your ${merchant} subscription`,
        annualSavingsCents: 18_588,
        confidence: "high",
        evidence: {},
      },
    });
  }

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await person("me", "Mineflix");
    await person("other", "Otherflix");
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await client.$disconnect();
  });

  const run = (name: string, input: object = {}) =>
    runAskTool(ids.me, name, input, { client, now: NOW });

  it.each(ASK_TOOLS.map((t) => [t.name]))(
    "%s only reads the signed-in person's data",
    async (name) => {
      const { content } = await run(name);
      expect(content).not.toMatch(/otherflix|other secret/i);
      // Never raw descriptions, card digits, account names, or a person named in a transfer.
      expect(content).not.toMatch(/4111|JORDAN|secret account|GROCER 4111/i);
    },
  );

  it("searches by merchant and returns totals it computed, with every figure recorded", async () => {
    const { content, cents } = await run("search_transactions", { merchant: "mineflix" });
    const result = JSON.parse(content);
    expect(result.matched).toBe(4);
    expect(result.totalMoneyOut).toBe("$126.47");
    expect(cents).toContain(12_647);
    expect(cents).toContain(1_549);
  });

  it("shows transfers without naming anyone", async () => {
    const { content } = await run("search_transactions", { category: "Transfers out" });
    expect(JSON.parse(content).transactions).toEqual([
      expect.objectContaining({ merchant: "Transfer", amount: "$200.00" }),
    ]);
  });

  it("lists the person's own findings with their estimates", async () => {
    const { content } = await run("list_findings");
    expect(JSON.parse(content).findings).toEqual([
      { title: "Review your Mineflix subscription", estimate: "about $185.88 a year" },
    ]);
  });

  it("refuses tools that don't exist", async () => {
    const { content, cents } = await run("delete_everything");
    expect(JSON.parse(content).error).toMatch(/no tool/);
    expect(cents).toEqual([]);
  });
});
