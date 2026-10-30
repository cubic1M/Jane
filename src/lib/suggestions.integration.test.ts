import { randomBytes } from "node:crypto";
import { cardHeadline } from "@/detectors/contract";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promisesHiddenPage } from "@/config/hidden-pages";
import { PEOPLE } from "@/config/people";
import { runDetectors } from "@/detectors";
import { buildProfile } from "@/profile/build";
import { ADVICE_TOPICS, SUGGESTIONS_PER_DAY } from "@/config/suggestions";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { suggestionsSource } from "@/lib/jane-agent/sources/suggestions";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { loadProfileInput } from "@/lib/profile";
import { answerSuggestion, explainSuggestion, offeredToday, scanSuggestions } from "./suggestions";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const TOMORROW = new Date("2026-10-19T15:00:00Z");
const LATER = new Date("2026-10-22T15:00:00Z");

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
    // The verified savings record: each pick is on it as shown, with what to watch if any.
    const outcomes = await client.suggestionOutcome.findMany({ where: { userId } });
    expect(outcomes.map((o) => o.suggestionKey).sort()).toEqual([...out.selected].sort());
    expect(outcomes.every((o) => o.status === "shown")).toBe(true);
    const stored = await client.suggestion.findMany({
      where: { userId, key: { in: out.selected } },
      select: { key: true, watch: true },
    });
    for (const o of outcomes) {
      expect(o.watch ?? null).toEqual(stored.find((r) => r.key === o.suggestionKey)!.watch ?? null);
    }
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

  // Overnight upload QA: a pick made from the first file kept its figures after a second upload
  // changed them, in the chat message too ("$548/yr" against the report's "$473").
  it("gives today's picks the new figures when the scan runs again the same day", async () => {
    const userId = made.get("renter")!;
    const [top] = await offeredToday(userId, { client, now: NOW });
    const fresh = await client.suggestion.findFirstOrThrow({ where: { userId, key: top.key } });
    await client.suggestion.updateMany({
      where: { userId, key: top.key },
      data: { worthCents: 1, headline: "Old headline, save $0/yr", why: "Old why." },
    });
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "Old headline, save $0/yr",
        refs: { suggestion: top.key, suggestionWhy: "Old why." },
        dedupeKey: `test-old-figures:${top.key}`,
      },
    });
    await scanSuggestions(userId, { client, now: NOW });
    const after = await client.suggestion.findFirstOrThrow({ where: { userId, key: top.key } });
    expect([after.worthCents, after.headline, after.why, after.status]).toEqual([
      fresh.worthCents,
      fresh.headline,
      fresh.why,
      "selected",
    ]);
    const updated = await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.body).toContain(cardHeadline(fresh.headline));
    expect((updated.refs as { suggestionWhy?: string }).suggestionWhy).toBe(fresh.why);
    await client.janeMessage.delete({ where: { id: message.id } });
  });

  it("shows the short card, and the whole explanation behind Why?", async () => {
    const userId = made.get("renter")!;
    const [top] = await offeredToday(userId, { client, now: NOW });
    expect(top.headline.length).toBeLessThanOrEqual(60);
    expect(top.short.length).toBeLessThanOrEqual(120);
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    const [message] = suggestionsSource
      .gather(snapshot!, { now: NOW } as never)
      .filter((m) => m.refs.suggestion === top.key);
    // The card is short: headline, why you, how sure. Not the long title and why.
    expect(message.body.split("\n")).toHaveLength(3);
    expect(message.body).toContain(cardHeadline(top.headline));
    expect(message.body).not.toContain(top.why);
    const whole = await explainSuggestion(userId, top.key, { client });
    expect(whole).toContain(top.why.replace(/[.!?]+$/, ""));
    expect(whole).toContain(`${top.confidencePercent}% sure, based on ${top.confidenceReason}.`);
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
      "snooze",
      "suggestion.no",
      "suggestion.why",
      "open",
    ]);
    await answerSuggestion(userId, top.key, "no", { client, now: NOW });
    // On the record as declined.
    expect(
      (
        await client.suggestionOutcome.findFirstOrThrow({
          where: { userId, suggestionKey: top.key },
        })
      ).status,
    ).toBe("declined");
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
  // Founder, 2026-10-30: no suggestion whose button promises a task on a page the beta hides
  // ("Start a claim" landing on /insurance), on the dock, the chat's cards, Home or anywhere a
  // stored suggestion shows; one stored before the page was hidden goes at the next scan.
  it("never offers a task on a page the beta hides, and lets one already stored go", async () => {
    let caught = 0;
    for (const person of PEOPLE) {
      const userId = made.get(person.id)!;
      const input = await loadProfileInput(userId, { client, now: LATER });
      const hidden = runDetectors({ profile: buildProfile(input), data: input }).filter((s) =>
        [s.action, ...(s.more ?? [])].some(promisesHiddenPage),
      );
      caught += hidden.length;
      // One already picked for the day, as before the page was hidden.
      if (hidden[0]) {
        const h = hidden[0];
        await client.suggestion.upsert({
          where: { userId_key: { userId, key: h.id } },
          create: {
            userId,
            key: h.id,
            capability: h.capability,
            topic: h.topic,
            title: h.title,
            worthCents: h.worthCents,
            worthKind: h.worthKind,
            confidencePercent: h.confidence.percent,
            confidenceReason: h.confidence.reason,
            urgency: h.urgency,
            why: h.why,
            actionLabel: h.action.label,
            actionHref: h.action.href,
            status: "selected",
            selectedOn: new Date("2026-10-22"),
          },
          update: { status: "selected", selectedOn: new Date("2026-10-22") },
        });
      }
      await scanSuggestions(userId, { client, now: LATER });
      const keys = new Set(hidden.map((s) => s.id));
      const showing = await client.suggestion.findMany({
        where: { userId, status: { in: ["waiting", "selected"] } },
        select: { key: true },
      });
      expect(showing.filter((r) => keys.has(r.key))).toEqual([]);
      const offered = await offeredToday(userId, { client, now: LATER });
      expect(offered.filter((o) => keys.has(o.key))).toEqual([]);
      if (hidden[0]) {
        const row = await client.suggestion.findFirst({ where: { userId, key: hidden[0].id } });
        expect(row?.status).toBe("gone");
      }
    }
    // The sample people do have some for it to catch.
    expect(caught).toBeGreaterThan(0);
  });
});
