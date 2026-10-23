import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { runDetection } from "@/detection/engine";
import { loadHubAreas, loadHubTop } from "./load";
import { cashFlowView, heroView, tilesView } from "./view";

// The home hub's loader against a real, migrated Postgres: it gathers the pages' own numbers
// for one person (docs/design/home-hub.md).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");

describe.runIf(url)("the home hub's loader against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let emptyId: string;

  beforeAll(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const suffix = crypto.randomUUID();
    userId = (await client.user.create({ data: { email: `hub-${suffix}@example.com` } })).id;
    emptyId = (await client.user.create({ data: { email: `hub-empty-${suffix}@example.com` } })).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 250_000,
      },
    });
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    await client.transaction.createMany({
      data: ["2026-06-20", "2026-07-20", "2026-08-20", "2026-09-20"].map((d) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `n-${d}`,
        date: day(d),
        amountCents: 1549,
        description: "NETFLIX.COM",
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        categorySource: "rule" as const,
      })),
    });
    await runDetection(userId, { client, now: NOW });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, emptyId] } } });
    await client.$disconnect();
  });

  it("has nothing for someone with no accounts yet", async () => {
    expect(await loadHubTop(emptyId, { client, now: NOW })).toBeNull();
  });

  it("gathers the hero row and the month ahead from the pages' own numbers", async () => {
    const top = await loadHubTop(userId, { client, now: NOW });
    expect(top).not.toBeNull();
    const hero = heroView(top!.hero);
    expect(hero.netWorth?.cents).toBe(250_000);
    expect(hero.saved.cents).toBe(top!.home.moneyFoundCents);
    expect(hero.safe?.label).toMatch(/^Safe to spend/);
    // Netflix comes round again within the month.
    const strip = cashFlowView(top!.cashFlow);
    expect(strip.events.some((e) => e.kind === "bill" && /netflix/i.test(e.label))).toBe(true);
  });

  it("gathers a tile per area, and areas with nothing yet say so", async () => {
    const areas = await loadHubAreas(
      userId,
      { budgetsOver: 0, safeShort: false },
      { client, now: NOW },
    );
    const tiles = tilesView(areas);
    expect(tiles).toHaveLength(6);
    expect(tiles[0]).toMatchObject({ key: "money", value: expect.stringMatching(/^\$/) });
    expect(tiles.find((t) => t.key === "ahead")).toMatchObject({
      value: null,
      caption: "Set a goal",
    });
  });
});
