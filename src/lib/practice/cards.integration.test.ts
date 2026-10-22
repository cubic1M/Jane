import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));

import { adviceMode } from "@/lib/advice-mode";
import { runAutopilot } from "./autopilot";
import { dismissPracticeCard, practiceCards } from "./cards";
import { startPractice } from "./portfolio";
import { runPracticeDay } from "./scan";

// Spec step 296 against a real, migrated Postgres: what the scan and the autopilot did shows as
// cards, each with a percentage and its reason and only the pause switch behind its button;
// Got it puts a card away for good.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:00:00Z`);

describe.runIf(url)("the practice portfolio's cards", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("shows the week's trades and flags, and puts one away when asked", async () => {
    const user = await client.user.create({
      data: { email: `practice-cards-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    expect(await practiceCards(user.id, { client, now: at("2026-10-14") })).toEqual([]);

    await startPractice(user.id, 4, { client, now: at("2026-10-12") });
    await runAutopilot(user.id, { client, now: at("2026-10-12") });
    await runPracticeDay(user.id, { client, now: at("2026-10-16") });
    const cards = await practiceCards(user.id, { client, now: at("2026-10-16") });
    expect(cards.map((c) => c.id)).toContain("trades:2026-10-12");
    for (const card of cards) {
      expect(card.yesLabel).toBe("Pause switch");
      expect(card.details.confidence?.percent).toBeGreaterThan(0);
      expect(card.details.confidence?.reason.length).toBeGreaterThan(0);
    }

    await dismissPracticeCard(user.id, "trades:2026-10-12", { client, now: at("2026-10-16") });
    const after = await practiceCards(user.id, { client, now: at("2026-10-16") });
    expect(after.map((c) => c.id)).not.toContain("trades:2026-10-12");
    // A week on, they've gone by themselves.
    expect(await practiceCards(user.id, { client, now: at("2026-10-30") })).toEqual([]);
  });

  it("shows nothing outside demo advice mode", async () => {
    vi.mocked(adviceMode).mockResolvedValueOnce(false);
    expect(await practiceCards("anyone", { client })).toEqual([]);
  });
});
