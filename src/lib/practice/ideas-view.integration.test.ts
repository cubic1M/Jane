import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/investments/strategy-today", () => ({ strategyToday: vi.fn(async () => null) }));

import { PRACTICE_TOPIC, practiceIdeaId } from "@/config/practice-suggestions";
import { answerIdeaHere, practiceAnswers, practiceIdeasView } from "./ideas-view";
import { startPractice } from "./portfolio";

// The practice ideas where the person sees them, against a real, migrated Postgres: the ideas
// waiting with how sure Jane is, and the page's Yes and No counting as answers to the idea's
// suggestion (made when the nightly scan hasn't), so what Jane learns moves.

const url = process.env.TEST_DATABASE_URL;
const now = new Date("2026-10-15T15:00:00Z");

describe.runIf(url)("practice ideas on the page", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `practice-ideas-view-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await startPractice(user.id, 3, { client, now: new Date("2026-09-01T21:00:00Z") });
    const { id } = await client.practicePortfolio.findFirstOrThrow({ where: { userId: user.id } });
    return { userId: user.id, portfolioId: id };
  }

  async function idea(userId: string, portfolioId: string, kind: "drift_warning" | "cash_drag") {
    const key = `${kind}:test`;
    await client.practiceOpportunity.create({
      data: {
        portfolioId,
        userId,
        scannedAt: new Date(now.getTime() - 3_600_000),
        kind,
        ticker: "VTI",
        key,
        amountCents: 50_000,
        headline: "A practice idea",
        reason: "A practice idea for the test.",
        confidence: 70,
        details: {
          ask: {
            headline: "Check your mix: $500 off, near the band",
            short: "Stocks are 4.2 points off target; the band is 5.",
            worthCents: 50_000,
            worthKind: "risk",
          },
          figures: [{ label: "Off target", value: "$500.00" }],
          caps: ["At most 2 a month"],
          confidence: { percent: 70, reason: "a fixed measure" },
          trades: [],
        },
        status: "suggested",
        tradeIds: [],
      },
    });
    return practiceIdeaId(PRACTICE_TOPIC[kind], key);
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("lists the ideas waiting with how sure Jane is, and nothing learned yet", async () => {
    const { userId, portfolioId } = await person();
    const key = await idea(userId, portfolioId, "drift_warning");
    const view = await practiceIdeasView(userId, { client, now });
    expect(view.ideas).toHaveLength(1);
    expect(view.ideas[0]).toMatchObject({
      suggestionKey: key,
      kind: "drift_warning",
      confidence: { percent: 70 },
    });
    expect(view.learned).toEqual([]);
    expect(view.strategy).toBeNull();
  });

  it("counts a No on the page toward what Jane learns, before the nightly scan has run", async () => {
    const { userId, portfolioId } = await person();
    const key = await idea(userId, portfolioId, "cash_drag");
    expect(await client.suggestion.count({ where: { userId, key } })).toBe(0);

    const out = await answerIdeaHere(userId, key, "no", { client, now });
    expect(out?.note).toMatch(/put that practice idea away/);
    const row = await client.suggestion.findFirstOrThrow({ where: { userId, key } });
    expect(row).toMatchObject({ status: "no", topic: PRACTICE_TOPIC.cash_drag });
    expect(
      (
        await client.practiceOpportunity.findFirstOrThrow({
          where: { userId, key: "cash_drag:test" },
        })
      ).status,
    ).toBe("declined");
    expect(await practiceAnswers(userId, { client })).toEqual({
      [PRACTICE_TOPIC.cash_drag]: { yes: 0, no: 1 },
    });
    const view = await practiceIdeasView(userId, { client, now });
    expect(view.ideas).toEqual([]);
    expect(view.learned).toMatchObject([{ kind: "cash_drag", effect: "later", no: 1 }]);
  });

  it("answers Yes on an idea without trades by opening the settings, and refuses a stranger's key", async () => {
    const { userId, portfolioId } = await person();
    const key = await idea(userId, portfolioId, "drift_warning");
    const other = await person();
    expect(await answerIdeaHere(other.userId, key, "yes", { client, now })).toBeNull();

    const out = await answerIdeaHere(userId, key, "yes", { client, now });
    expect(out?.href).toBe("/investments/practice/settings");
    expect(await practiceAnswers(userId, { client })).toEqual({
      [PRACTICE_TOPIC.drift_warning]: { yes: 1, no: 0 },
    });
  });
});
