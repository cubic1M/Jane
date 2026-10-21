import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { ADVICE_TOPICS, SUGGESTIONS_PER_DAY } from "@/config/suggestions";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { suggestionsSource } from "@/lib/jane-agent/sources/suggestions";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { answerSuggestion, offeredToday, scanSuggestions } from "./suggestions";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const TOMORROW = new Date("2026-10-19T15:00:00Z");

describe.runIf(url)("the nightly scan of suggestions", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made = new Map<string, string>();

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    for (const p of PEOPLE) {
      const trial = await startTrial({ client, now: NOW, defer: true, person: p.id });
      await syncItem(trial.itemId, { client, now: NOW });
      made.set(p.id, trial.userId);
    }
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE)("$id gets their top suggestions from their written list", async (person) => {
    const userId = made.get(person.id)!;
    const out = await scanSuggestions(userId, { client, now: NOW });
    expect(out.selected.length).toBeGreaterThan(0);
    expect(out.selected.length).toBeLessThanOrEqual(SUGGESTIONS_PER_DAY);
    const offered = await offeredToday(userId, { client, now: NOW });
    expect(offered.map((o) => o.key).sort()).toEqual([...out.selected].sort());
    for (const o of offered) {
      expect(person.mustNot).not.toContain(o.topic);
      expect(o.confidencePercent).toBeGreaterThan(0);
    }
    expect(person.should).toContain(offered[0].topic);
  });

  it("is safe to run twice in a day, and ranks again tomorrow", async () => {
    const userId = made.get("debt")!;
    const first = await offeredToday(userId, { client, now: NOW });
    await scanSuggestions(userId, { client, now: NOW });
    expect((await offeredToday(userId, { client, now: NOW })).map((o) => o.key)).toEqual(
      first.map((o) => o.key),
    );
    // Tomorrow the ones offered and left alone wait their turn; the next best are chosen.
    await scanSuggestions(userId, { client, now: TOMORROW });
    const next = await offeredToday(userId, { client, now: TOMORROW });
    expect(next.length).toBeGreaterThan(0);
    expect(next.map((o) => o.key).filter((k) => first.some((f) => f.key === k))).toEqual([]);
  });

  it("never offers a no again, and the source says how sure Jane is", async () => {
    const userId = made.get("renter")!;
    const [top] = await offeredToday(userId, { client, now: NOW });
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    const [message] = suggestionsSource
      .gather(snapshot!, { now: NOW } as never)
      .filter((m) => m.refs.suggestion === top.key);
    expect(message.body).toContain(`${top.confidencePercent}% sure: `);
    expect(message.actions.map((a) => a.id)).toEqual([
      "suggestion.yes",
      "suggestion.no",
      "suggestion.why",
      "open",
    ]);
    await answerSuggestion(userId, top.key, "no", { client, now: NOW });
    expect((await offeredToday(userId, { client, now: NOW })).some((o) => o.key === top.key)).toBe(
      false,
    );
    for (let day = 1; day <= 40; day += 1) {
      await scanSuggestions(userId, { client, now: new Date(NOW.getTime() + day * 86_400_000) });
      const rows = await client.suggestion.findMany({ where: { userId, key: top.key } });
      expect(rows[0].status).toBe("no");
    }
  });

  it("gives no recommendations on investments, taxes, insurance or loans to real accounts", async () => {
    {
      const trial = await startTrial({ client, now: NOW, defer: true, person: "family" });
      made.set("real-copy", trial.userId);
      await syncItem(trial.itemId, { client, now: NOW });
      // A CSV account next to the demo bank turns demo advice off (src/lib/advice-mode.ts).
      await client.account.create({
        data: {
          userId: trial.userId,
          source: "csv",
          name: "My real account",
          type: "depository",
          currentBalanceCents: 1000,
        },
      });
      await scanSuggestions(trial.userId, { client, now: NOW });
      const rows = await client.suggestion.findMany({ where: { userId: trial.userId } });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(ADVICE_TOPICS as readonly string[]).not.toContain(r.topic);
    }
  });
});
