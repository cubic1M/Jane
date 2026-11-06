import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { CHAT_TOOLS, runChatTool } from "./claude-tools";

// Every tool Claude can call takes the person's day (founder 10-23, src/lib/today.ts), not UTC's.
// Two identical sample people, one asked at 3pm and one at 7pm in Los Angeles, when UTC is already
// tomorrow: every tool has to say the same. The night round of 11-06 found 25 tools that didn't:
// a goal's months (Jun 5 was 6 months off at 7pm, so $2,000 a month, not $1,714.29), a year of pay
// and of payments counted from the clock, tax set-asides, tight money's requests, card picks.
const url = process.env.TEST_DATABASE_URL;
// Each moment is the same person's day at both times, and UTC's next day at the second. A month's
// and a year's last evening are where a UTC day hurts most: the night round of 11-06 found 25 more
// tools there (the tax calendar's month, a typical month a month early, every year-end tax move
// gone at 7pm on Dec 31, this year's gifts, a card's rate-request month).
const MOMENTS: { when: string; early: Date; late: Date; lives: PersonId[] }[] = [
  // Between them these lives have goals, debts in trouble, self-employment, a business and a home.
  {
    when: "Nov 5, 3pm and 7pm",
    early: new Date("2026-11-05T23:00:00Z"),
    late: new Date("2026-11-06T03:00:00Z"),
    lives: ["preretire", "debt", "freelancer", "owner"],
  },
  {
    when: "Oct 31, 4pm and 8pm",
    early: new Date("2026-10-31T23:00:00Z"),
    late: new Date("2026-11-01T03:00:00Z"),
    lives: ["family", "retiree", "debt", "preretire"],
  },
  {
    when: "Dec 31, 3pm and 7pm",
    early: new Date("2026-12-31T23:00:00Z"),
    late: new Date("2027-01-01T03:00:00Z"),
    lives: ["family", "preretire", "owner", "retiree"],
  },
];
// The market's day, not the person's: prices are as of the last close, which turns over at
// midnight UTC, 7pm in New York, after the close (src/lib/market-data/partner.ts lastClose).
const MARKET_DAY = new Set([
  "backtest_by_level",
  "investment_returns",
  "practice_portfolio",
  "investments_overview",
  "honest_performance",
  "steady_hand",
]);

const inputFor = (tool: (typeof CHAT_TOOLS)[number]) => {
  const schema = tool.input_schema as {
    required?: string[];
    properties?: Record<string, { type?: string; enum?: unknown[] }>;
  };
  return Object.fromEntries(
    (schema.required ?? []).map((key) => {
      const property = schema.properties?.[key];
      if (property?.enum?.length) return [key, property.enum[0]];
      return [key, property?.type === "number" ? 1 : "groceries"];
    }),
  );
};
// Two people's rows have different ids, and rows alike in their sort keys fall in id order, so
// ids are masked and lists compared as sets. The search's 25 shown are compared by their dates:
// which of two same-day rows makes the cut follows the ids too.
const canon = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canon).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canon(v)]),
    );
  }
  return value;
};
const masked = (name: string, content: string) => {
  const text = content
    .replace(/\bc[a-z0-9]{24}\b/g, "ID")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "UUID");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (name === "search_transactions" && Array.isArray(parsed.transactions)) {
    parsed.transactions = (parsed.transactions as { date: string }[]).map((t) => t.date);
  }
  return JSON.stringify(canon(parsed));
};

describe.runIf(url)("Claude's tools in the person's own day", { timeout: 1_200_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    for (const id of made) await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  it.each(MOMENTS.flatMap((m) => m.lives.map((life) => ({ ...m, life }))))(
    "say the same on $when for $life",
    async ({ early, late, life }) => {
      const afternoon = await createCheckPerson({ client, now: early, person: life });
      const evening = await createCheckPerson({ client, now: early, person: life });
      made.push(afternoon, evening);
      const differ: string[] = [];
      for (const tool of CHAT_TOOLS) {
        if (MARKET_DAY.has(tool.name)) continue;
        const ask = async (id: string, now: Date) =>
          masked(
            tool.name,
            (await runChatTool(id, tool.name, inputFor(tool), { client, now })).content,
          );
        const said = await ask(evening, late);
        if ((await ask(afternoon, early)) === said) continue;
        // Two people can still differ where rows tie and fall in id order, or where a sample's second
        // bank login is linked by a later step: asked again at the earlier time, the evening person
        // says the same as at the later one unless the day is what changed it.
        if ((await ask(evening, early)) !== said) differ.push(tool.name);
      }
      expect(differ).toEqual([]);
    },
  );
});
