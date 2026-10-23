import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("./opportunity-prefs", async (original) => {
  const actual = await original<typeof import("./opportunity-prefs")>();
  return { ...actual, scanPreferences: vi.fn(actual.scanPreferences) };
});

import {
  PRACTICE_SETTINGS_HREF,
  PRACTICE_TOPIC,
  PRACTICE_YES_DOES,
  practiceIdeaId,
} from "@/config/practice-suggestions";
import { encrypt } from "@/lib/crypto";
import { linkDemoBank } from "@/lib/plaid/demo";
import { detectFor, offeredToday, scanSuggestions } from "@/lib/suggestions";
import { DEFAULT_SCAN_PREFERENCES } from "@/planning/practice-opportunities";
import { runAutopilot, setPaused } from "./autopilot";
import { practiceCards } from "./cards";
import { answerPracticeIdea, openPracticeIdeas } from "./ideas";
import { scanPreferences } from "./opportunity-prefs";
import { startPractice } from "./portfolio";
import { scanPractice } from "./scan";

// The practice scan's ideas as suggestions (Phase AW, Stage A) against a real, migrated
// Postgres: suggest-only ideas reach the nightly suggestion scan; Yes places the idea's trades
// in the practice ledger only, once, within the caps; No puts it away; an idea without trades
// opens the settings; a real account never gets one.

const url = process.env.TEST_DATABASE_URL;
const ideaKey = (i: { kind: string; key: string }) =>
  practiceIdeaId(PRACTICE_TOPIC[i.kind as keyof typeof PRACTICE_TOPIC], i.key);
const at = (day: string, time = "21:30:00") => new Date(`${day}T${time}Z`);

describe.runIf(url)("practice ideas as suggestions", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (bank: "demo" | "real" = "demo", level: 2 | 4 = 2) => {
    const user = await client.user.create({
      data: { email: `practice-ideas-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (bank === "demo") await linkDemoBank(user.id, { client });
    else {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `item-${crypto.randomUUID()}`,
          accessTokenEncrypted: encrypt("access-sandbox-real"),
          institutionName: "First Real Bank",
        },
      });
    }
    // Low by default: the rule replay turned tax-loss swaps off from Medium up
    // (OPPORTUNITY_RULES_OFF), and most ideas here are a harvest.
    await startPractice(user.id, level, { client, now: at("2026-09-01") });
    await runAutopilot(user.id, { client, now: at("2026-09-01") });
    return user.id;
  };
  // A suggest-only scan in this autumn's dip: a tax-loss swap and a dip buy wait for the person.
  const suggestOnly = async (userId: string) => {
    vi.mocked(scanPreferences).mockResolvedValueOnce({
      ...DEFAULT_SCAN_PREFERENCES,
      mode: "suggest",
    });
    await scanPractice(userId, { client, now: at("2026-10-14") });
  };

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("brings suggest-only ideas into the nightly suggestion scan, one suggestion each", async () => {
    const userId = await person();
    await suggestOnly(userId);
    const ideas = await openPracticeIdeas(userId, { client, now: at("2026-10-15", "15:00:00") });
    const harvest = ideas.find((i) => i.kind === "tax_loss_harvest");
    expect(harvest?.trades).toBe(2);
    await scanSuggestions(userId, { client, now: at("2026-10-15", "15:00:00") });
    const row = await client.suggestion.findFirst({
      where: { userId, key: practiceIdeaId("practice_tax_loss_harvest", harvest!.key) },
    });
    expect(row).not.toBeNull();
    expect(row?.confidencePercent).toBe(harvest?.confidence.percent);
    expect(row?.why).toMatch(/The caps: /);
    // Offered today, its card carries the numbers, the caps and what Yes does.
    await client.suggestion.updateMany({
      where: { id: row!.id },
      data: { status: "selected", selectedOn: new Date("2026-10-15") },
    });
    const offered = await offeredToday(userId, { client, now: at("2026-10-15", "15:00:00") });
    const card = offered.find((o) => o.key === row!.key)?.cardDetails;
    expect(card?.figures.length).toBeGreaterThan(0);
    expect(card?.caps.length).toBeGreaterThan(0);
    expect(card?.whatYesDoes).toBe(PRACTICE_YES_DOES.trades);
    // A waiting idea is a suggestion, not one of the practice cards: it isn't shown twice.
    const waiting = await client.practiceOpportunity.findMany({
      where: { userId, status: "suggested" },
    });
    const cards = await practiceCards(userId, { client, now: at("2026-10-15", "15:00:00") });
    for (const w of waiting) expect(cards.map((c) => c.id)).not.toContain(`opportunity:${w.id}`);
  });

  it("places the idea's trades in the practice ledger on Yes, once, and puts one away on No", async () => {
    const userId = await person();
    await suggestOnly(userId);
    const ideas = await openPracticeIdeas(userId, { client, now: at("2026-10-15", "15:00:00") });
    const harvest = ideas.find((i) => i.kind === "tax_loss_harvest")!;
    const key = practiceIdeaId("practice_tax_loss_harvest", harvest.key);
    const now = at("2026-10-15", "15:00:00");
    const before = await client.practiceTrade.count({ where: { userId } });

    const yes = await answerPracticeIdea(userId, key, "yes", { client, now });
    expect(yes?.note).toMatch(/^Done in your practice portfolio: sold .* bought .*nothing real/);
    expect(await client.practiceTrade.count({ where: { userId } })).toBe(before + 2);
    const row = await client.practiceOpportunity.findFirst({ where: { userId, key: harvest.key } });
    expect(row?.status).toBe("acted");
    expect(row?.tradeIds.length).toBe(2);
    // A second tap does nothing.
    const again = await answerPracticeIdea(userId, key, "yes", { client, now });
    expect(again?.note).toMatch(/already moved on/);
    expect(await client.practiceTrade.count({ where: { userId } })).toBe(before + 2);

    const other = ideas.find((i) => i.key !== harvest.key)!;
    const no = await answerPracticeIdea(userId, ideaKey(other), "no", { client, now });
    expect(no?.note).toMatch(/put that practice idea away/);
    const declined = await client.practiceOpportunity.findFirst({
      where: { userId, key: other.key },
    });
    expect(declined?.status).toBe("declined");
    expect(await client.practiceTrade.count({ where: { userId } })).toBe(before + 2);
  });

  it("checks the never-buy list as it stands when the person says Yes", async () => {
    const userId = await person();
    await suggestOnly(userId);
    const ideas = await openPracticeIdeas(userId, { client, now: at("2026-10-15", "15:00:00") });
    const harvest = ideas.find((i) => i.kind === "tax_loss_harvest")!;
    // Since the idea was found, the fund it buys went on the never-buy list.
    await client.practicePreferences.create({
      data: {
        userId,
        monthlyAddCents: 50_000,
        addDay: 1,
        appetite: "normal",
        avoid: ["ITOT"],
        harvestLosses: true,
        cashBufferCents: 0,
        mode: "suggest",
      },
    });
    const before = await client.practiceTrade.count({ where: { userId } });
    const out = await answerPracticeIdea(userId, ideaKey(harvest), "yes", {
      client,
      now: at("2026-10-15", "15:00:00"),
    });
    expect(out?.note).toMatch(/never-buy list/);
    expect(await client.practiceTrade.count({ where: { userId } })).toBe(before);
  });

  it("opens the settings for an idea without trades, and does nothing while paused", async () => {
    // High: a crash could take its mix past what "sell" can live with.
    const userId = await person("demo", 4);
    await client.investorProfile.create({ data: { userId, dropReaction: "sell" } });
    await scanPractice(userId, { client, now: at("2026-10-14") });
    const ideas = await openPracticeIdeas(userId, { client, now: at("2026-10-15", "15:00:00") });
    const risk = ideas.find((i) => i.kind === "risk_mismatch");
    expect(risk?.trades).toBe(0);
    const out = await answerPracticeIdea(
      userId,
      practiceIdeaId("practice_risk_mismatch", risk!.key),
      "yes",
      { client },
    );
    expect(out?.href).toBe(PRACTICE_SETTINGS_HREF);

    const other = await person();
    await suggestOnly(other);
    const [first] = (await openPracticeIdeas(other, { client, now: at("2026-10-15") })).filter(
      (i) => i.trades > 0,
    );
    await setPaused(other, "all", true, { client });
    const paused = await answerPracticeIdea(other, ideaKey(first), "yes", {
      client,
      now: at("2026-10-15"),
    });
    expect(paused?.note).toMatch(/paused/);
  });

  it("ignores keys that aren't practice ideas, and gives a real account none", async () => {
    expect(await answerPracticeIdea("nobody", "investing:rebalance", "yes", { client })).toBeNull();
    const userId = await person("real");
    const portfolio = await client.practicePortfolio.findFirstOrThrow({ where: { userId } });
    // Even an idea stored for them is never suggested: practice topics are demo advice.
    await client.practiceOpportunity.create({
      data: {
        portfolioId: portfolio.id,
        userId,
        scannedAt: at("2026-10-14"),
        kind: "cash_drag",
        ticker: "VTI",
        key: "cash_drag:2026-10:w2",
        amountCents: 50_000,
        headline: "Invest $500.00 of idle cash",
        reason: "Cash has waited.",
        confidence: 80,
        details: {
          ask: {
            headline: "Invest idle practice cash, about $20 a year more",
            short: "$500.00 has waited 37 days above your buffer.",
            worthCents: 2_000,
            worthKind: "earns",
          },
          trades: [{ ticker: "VTI", side: "buy", amountCents: 50_000 }],
        },
        status: "suggested",
        tradeIds: [],
      },
    });
    const { suggestions, advice } = await detectFor(userId, { client, now: at("2026-10-15") });
    expect(advice).toBe(false);
    expect(suggestions.some((s) => s.topic.startsWith("practice_"))).toBe(false);
  });
});
