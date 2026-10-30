import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { listDeadlines } from "@/lib/deadlines";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadPriceRises } from "@/lib/price-rises";

// The founder's live /deadlines (10-29), with made-up rows of the same shape, against a real,
// migrated Postgres. A movie ticket ("AMC ONLINE -- KS 12/06", the theater, not AMC+) and a campus
// bookstore receipt from last December were listed as "Price goes up · ... renews" cards, under
// their raw bank names, and the chat, searching from Aug 1, said it found no such charges. A
// real yearly membership is still a renewal, and the chat finds every card's charge.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-29T15:00:00Z");

describe.runIf(url)("a one-off charge a year ago is not a yearly plan", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `phantom-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Card", type: "credit", subtype: "credit card" },
    });
    const row = (
      date: string,
      cents: number,
      description: string,
      primary: string,
      pfc: string,
    ) => ({
      userId,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      amountCents: cents,
      description,
      pfcPrimary: primary,
      pfcDetailed: pfc,
    });
    // A year of groceries, so the history reaches back past the one-offs.
    const groceries = Array.from({ length: 13 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 9 + i, 3)).toISOString().slice(0, 10);
      return row(d, 6_000 + i * 37, "KROGER #412", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES");
    });
    await client.transaction.createMany({
      data: [
        ...groceries,
        row(
          "2025-12-06",
          1_068,
          "AMC ONLINE -- KS 12/06",
          "ENTERTAINMENT",
          "ENTERTAINMENT_TV_AND_MOVIES",
        ),
        row(
          "2025-12-14",
          4_409,
          "BBOOKSTORE ST839 CHICAGO IL 12/16",
          "GENERAL_MERCHANDISE",
          "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
        ),
        row(
          "2025-12-10",
          7_900,
          "AMC STUBS A-LIST ANNUAL MEMBERSHIP",
          "ENTERTAINMENT",
          "ENTERTAINMENT_TV_AND_MOVIES",
        ),
      ],
    });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("lists no renewal for the movie ticket or the bookstore receipt", async () => {
    const deadlines = await listDeadlines(userId, { client, now: NOW });
    const said = deadlines.map((d) => `${d.title} ${d.detail ?? ""}`).join("\n");
    expect(said).not.toMatch(/amc online|bookstore/i);
    // The yearly membership is a yearly plan, said as a renewal (never "Price goes up").
    const rises = await loadPriceRises(userId, { client, now: NOW });
    expect(rises.map((r) => r.kind)).toEqual(["annual_renewal"]);
    expect(rises[0].chargedOn).toBe("2025-12-10");
    expect(deadlines.filter((d) => d.kind === "price_rise")).toEqual([]);
    const renewal = deadlines.find((d) => d.kind === "renewal");
    expect(renewal).toMatchObject({ date: "2026-12-10", chargedOn: "2025-12-10" });
    expect(renewal?.title).toMatch(/^Amc .* renews$/);
  });

  it("finds a charge from before the dates asked, rather than saying there are none", async () => {
    const found = JSON.parse(
      (
        await runChatTool(
          userId,
          "search_transactions",
          { merchant: "AMC Online", from: "2026-08-01" },
          { client, now: NOW },
        )
      ).content,
    );
    expect(found.matched).toBe(0);
    expect(found.outsideTheseDates).toEqual([
      { date: "2025-12-06", merchant: "Amc Online", amount: "$10.68", direction: "out" },
    ]);
  });
});
