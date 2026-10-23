import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import {
  PRACTICE_RANK_FLOOR_CENTS,
  PRACTICE_TOPIC,
  practiceIdeaId,
} from "@/config/practice-suggestions";
import { HISTORY_MIN_FACTOR, NO_PENALTY, SAFETY_HISTORY_FLOOR } from "@/config/suggestions";
import { linkDemoBank } from "@/lib/plaid/demo";
import { answerSuggestion, scanSuggestions } from "@/lib/suggestions";
import { startPractice } from "./portfolio";

// Adapting to the person (Phase AW, Stage A) against a real, migrated Postgres: what they say
// to past practice ideas moves the rank of that kind in the nightly suggestion scan. A kind
// they keep declining falls; a safety kind keeps its floor, so it never vanishes; the idea
// they said no to is never offered again, but the next one of its kind is.

const url = process.env.TEST_DATABASE_URL;
const now = new Date("2026-10-15T15:00:00Z");
type Kind = keyof typeof PRACTICE_TOPIC;

describe.runIf(url)("practice ideas adapt to the person's answers", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function idea(userId: string, portfolioId: string, kind: Kind, key: string) {
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
          figures: [{ label: "Stocks", value: "64.2%" }],
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
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("lowers a kind they keep declining, keeps a safety kind's floor, and offers the next idea", async () => {
    const user = await client.user.create({
      data: { email: `practice-adapt-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await linkDemoBank(user.id, { client });
    await startPractice(user.id, 4, { client, now: new Date("2026-09-01T21:00:00Z") });
    const { id: portfolioId } = await client.practicePortfolio.findFirstOrThrow({
      where: { userId: user.id },
    });

    // Last week: three news ideas and three drift warnings, each offered and declined.
    const old: string[] = [];
    for (const kind of ["news_idea", "drift_warning"] as const) {
      for (let i = 1; i <= 3; i += 1) {
        const key = await idea(user.id, portfolioId, kind, `${kind}:old-${i}`);
        await client.practiceOpportunity.updateMany({
          where: { userId: user.id, key: `${kind}:old-${i}` },
          data: { status: "declined" },
        });
        await client.suggestion.create({
          data: {
            userId: user.id,
            key,
            capability: "investing",
            topic: PRACTICE_TOPIC[kind],
            title: "A practice idea.",
            worthCents: 50_000,
            worthKind: "risk",
            confidencePercent: 70,
            confidenceReason: "a fixed measure",
            urgency: "soon",
            why: "For the test.",
            actionLabel: "See your mix",
            actionHref: "/investments/practice",
          },
        });
        await answerSuggestion(user.id, key, "no", {
          client,
          now: new Date("2026-10-08T16:00:00Z"),
        });
        old.push(key);
      }
    }

    // Tonight: a new one of each, worth the same.
    const news = await idea(user.id, portfolioId, "news_idea", "news_idea:new");
    const drift = await idea(user.id, portfolioId, "drift_warning", "drift_warning:new");
    await scanSuggestions(user.id, { client, now });
    const rows = await client.suggestion.findMany({ where: { userId: user.id } });
    const score = (key: string) => rows.find((r) => r.key === key)?.score ?? -1;
    // The declined ideas are never offered again.
    for (const key of old) expect(rows.find((r) => r.key === key)?.status).toBe("no");
    // The next of each kind is: the news idea far down, the safety one at its floor.
    // What it can be expected to gain (urgency only breaks ties), times the person's answers.
    const expected = (kind: Kind, history: number) =>
      Math.round(PRACTICE_RANK_FLOOR_CENTS[kind] * 0.7 * history);
    expect(score(news)).toBe(expected("news_idea", Math.max(HISTORY_MIN_FACTOR, NO_PENALTY ** 3)));
    expect(score(drift)).toBe(expected("drift_warning", SAFETY_HISTORY_FLOOR));
    expect(score(drift)).toBeGreaterThan(score(news));
  });
});
