import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { suggestionsSource } from "@/lib/jane-agent/sources/suggestions";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { answerSuggestion, offeredToday, scanSuggestions } from "./suggestions";

// A Yes stops a suggestion coming back, unless the fix failed: then the nightly scan brings it back
// first, saying why and what to try next. A clean no is final either way. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const next = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const WORDS = "Still charged: $9.99 on Oct 1.";

describe.runIf(url)("a failed fix in the nightly scan", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  // A sample person with a Yes on their top pick.
  async function saidYes() {
    const trial = await startTrial({ client, now: NOW, defer: true });
    await syncItem(trial.itemId, { client, now: NOW });
    made.push(trial.userId);
    const { selected } = await scanSuggestions(trial.userId, { client, now: NOW });
    const key = selected.find((k) => !k.startsWith("strategist:"))!;
    await answerSuggestion(trial.userId, key, "yes", { client, now: NOW });
    return { userId: trial.userId, key };
  }

  const fail = (userId: string, key: string, told = true) =>
    client.suggestionOutcome.updateMany({
      where: { userId, suggestionKey: key },
      data: {
        status: "not_seen",
        proof: WORDS,
        failedAt: next(1),
        ...(told ? { comebackAt: next(1), comebacks: 1 } : {}),
      },
    });
  const statusOf = async (userId: string, key: string) =>
    (await client.suggestion.findFirstOrThrow({ where: { userId, key } })).status;

  it("a Yes that's still open never comes back", async () => {
    const { userId, key } = await saidYes();
    const { selected } = await scanSuggestions(userId, { client, now: next(9) });
    expect(selected).not.toContain(key);
    expect(await statusOf(userId, key)).toBe("yes");
  });

  it("a failure not told yet stays blocked", async () => {
    const { userId, key } = await saidYes();
    await fail(userId, key, false);
    const { selected } = await scanSuggestions(userId, { client, now: next(9) });
    expect(selected).not.toContain(key);
    expect(await statusOf(userId, key)).toBe("yes");
  });

  it("a failed fix comes back first, saying why and the next step; a Yes starts over", async () => {
    const { userId, key } = await saidYes();
    await fail(userId, key);
    const { selected } = await scanSuggestions(userId, { client, now: next(9) });
    expect(selected[0]).toBe(key);
    expect(await statusOf(userId, key)).toBe("selected");
    const [offered] = (await offeredToday(userId, { client, now: next(9) })).filter(
      (o) => o.key === key,
    );
    expect(offered.short).toContain(WORDS);
    expect(offered.why).toContain(WORDS);
    expect(offered.short).toContain("didn't hold");
    // It reaches the person as a card with the same words.
    const [card] = suggestionsSource
      .gather({ suggestions: [offered], asOf: "2026-10-27" } as never, {} as never)
      .filter((c) => c.refs.suggestion === key);
    expect(card.body).toContain(WORDS);

    await answerSuggestion(userId, key, "yes", { client, now: next(9) });
    const row = await client.suggestionOutcome.findFirstOrThrow({
      where: { userId, suggestionKey: key },
    });
    expect(row.failedAt).toBeNull();
    expect(row.proof).toBeNull();
    expect(["open", "unverifiable"]).toContain(row.status);
    const after = await scanSuggestions(userId, { client, now: next(10) });
    expect(after.selected).not.toContain(key);
  });

  it("a clean no is final, even if the fix failed before", async () => {
    const { userId, key } = await saidYes();
    await fail(userId, key);
    await scanSuggestions(userId, { client, now: next(9) });
    await answerSuggestion(userId, key, "no", { client, now: next(9) });
    for (const day of [10, 40, 90]) {
      const { selected } = await scanSuggestions(userId, { client, now: next(day) });
      expect(selected).not.toContain(key);
    }
    expect(await statusOf(userId, key)).toBe("no");
  });

  it("a fix the data verified after it came back settles as a Yes", async () => {
    const { userId, key } = await saidYes();
    await fail(userId, key);
    await scanSuggestions(userId, { client, now: next(9) });
    await client.suggestionOutcome.updateMany({
      where: { userId, suggestionKey: key },
      data: { status: "confirmed", confirmedCents: 1_000, verifiedAt: next(10), failedAt: null },
    });
    const { selected } = await scanSuggestions(userId, { client, now: next(12) });
    expect(selected).not.toContain(key);
    expect(await statusOf(userId, key)).toBe("yes");
  });

  async function unverifiableYes(userId: string, key: string) {
    await client.suggestion.create({
      data: {
        userId,
        key,
        capability: "made-up",
        topic: "made_up",
        title: "Something nothing can verify",
        worthCents: 0,
        worthKind: "saves",
        confidencePercent: 70,
        confidenceReason: "a test",
        urgency: "normal",
        why: "A test.",
        actionLabel: "Show me how",
        actionHref: "/spending",
      },
    });
    await answerSuggestion(userId, key, "yes", { client, now: NOW });
  }

  it("a Yes nothing can verify settles when Jane stops finding it, with current data", async () => {
    const trial = await startTrial({ client, now: NOW, defer: true });
    await syncItem(trial.itemId, { client, now: NOW });
    made.push(trial.userId);
    await unverifiableYes(trial.userId, "made-up:gone");
    await scanSuggestions(trial.userId, { client, now: next(1) });
    const row = await client.suggestionOutcome.findFirstOrThrow({
      where: { userId: trial.userId, suggestionKey: "made-up:gone" },
    });
    expect(row.status).toBe("no_longer_found");
    expect(row.settledAt).not.toBeNull();
  });

  it("but not when the statements are just old: that says nothing about the fix", async () => {
    const user = await client.user.create({
      data: { email: `comeback-${crypto.randomUUID()}@example.com` },
    });
    made.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        date: new Date("2026-05-01T00:00:00Z"),
        description: "GROCERY",
        amountCents: 3_000,
      },
    });
    await unverifiableYes(user.id, "made-up:old");
    await scanSuggestions(user.id, { client, now: next(1) });
    const row = await client.suggestionOutcome.findFirstOrThrow({
      where: { userId: user.id, suggestionKey: "made-up:old" },
    });
    expect(row.status).toBe("unverifiable");
  });
});
