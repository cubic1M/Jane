import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { runAutopilot } from "./autopilot";
import { answerIdeaHere, practiceIdeasView } from "./ideas-view";
import { startPractice } from "./portfolio";
import { savePreferences } from "./preferences";
import { runPracticeDay } from "./scan";

// The news themes against a real, migrated Postgres and the sample market: the day's news
// brings a theme idea that waits for a yes even when Jane acts by herself, Yes buys the small
// slice, and the autopilot gets out after the month, as the idea said. Practice money only.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:30:00Z`);

describe.runIf(url)("news themes in the practice portfolio", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("asks first, buys the slice on a yes, and gets out after the month", async () => {
    const user = await client.user.create({
      data: { email: `practice-themes-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await linkDemoBank(user.id, { client });
    await savePreferences(user.id, { riskLevel: 4 }, "page", { client, now: at("2026-09-01") });
    await startPractice(user.id, 4, { client, now: at("2026-09-01") });
    await runAutopilot(user.id, { client, now: at("2026-09-01") });

    // The sample's war on October 16: an idea, kept waiting though Jane acts by herself.
    await runPracticeDay(user.id, { client, now: at("2026-10-16") });
    const rows = await client.practiceOpportunity.findMany({
      where: { userId: user.id, kind: "theme_idea" },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "suggested")).toBe(true);
    expect(
      await client.practiceTrade.count({ where: { userId: user.id, rule: "theme_idea" } }),
    ).toBe(0);
    const view = await practiceIdeasView(user.id, { client, now: at("2026-10-16") });
    const idea = view.ideas.find((i) => i.kind === "theme_idea")!;
    expect(idea.confidence.percent).toBeGreaterThan(0);
    expect(idea.figures.map((f) => f.label)).toContain("When to get out");

    // Yes: the slice is bought, in practice.
    const yes = await answerIdeaHere(user.id, idea.suggestionKey, "yes", {
      client,
      now: at("2026-10-16"),
    });
    expect(yes?.note).toMatch(/^Done in your practice portfolio/);
    const buy = await client.practiceTrade.findFirstOrThrow({
      where: { userId: user.id, rule: "theme_idea", side: "buy" },
    });
    expect(["ITA", "SMH"]).toContain(buy.ticker);

    // A month of trading days later the autopilot sells it, by itself.
    const run = await runAutopilot(user.id, { client, now: at("2026-11-16") });
    expect(run.ran && run.fills.some((f) => f.ticker === buy.ticker && f.side === "sell")).toBe(
      true,
    );
    const exit = await client.practiceTrade.findFirstOrThrow({
      where: { userId: user.id, rule: "theme_exit" },
    });
    expect(exit.reason).toMatch(new RegExp(`^Out of ${buy.ticker} (after|at the stop)`));
  });
});
