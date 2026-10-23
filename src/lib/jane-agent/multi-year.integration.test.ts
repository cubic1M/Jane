import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RETIREMENT_AGE } from "@/config/retirement";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import {
  MultiYearError,
  addPlanEvent,
  loadMultiYear,
  putMoveOnPlan,
  removePlanEvent,
  setRetireYear,
} from "@/lib/multi-year";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { runChatTool } from "./claude-tools";
import { takeChatAction } from "./actions";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("tax moves over the years against a real database", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("starts from the estimate, and a planned withdrawal finds a better year", async () => {
    const userId = await person("years");
    const estimate = await loadTaxEstimate(userId, { client, now: LINKED });
    const v = await loadMultiYear(userId, { client, now: LINKED });
    // The first year is step 120's estimate.
    expect(v.rows[0]).toMatchObject({ year: 2026, totalTaxCents: estimate.estimate.totalTaxCents });
    expect(v.advice).toBe(true);
    expect(v.retireAssumed).toBe(true);
    expect(v.retireYear).toBe(2041);
    expect(v.assumptions[1]).toBe(
      "You haven't told me when you plan to retire, so I assumed 2041.",
    );

    await setRetireYear(userId, 2040, { client, now: LINKED, via: "page" });
    await expect(
      setRetireYear(userId, 1999, { client, now: LINKED, via: "page" }),
    ).rejects.toBeInstanceOf(MultiYearError);
    await addPlanEvent(
      userId,
      { kind: "withdrawal", year: 2030, amountCents: 8_000_000 },
      { client, now: LINKED, via: "page" },
    );
    await expect(
      addPlanEvent(
        userId,
        { kind: "nope", year: 2030, amountCents: 1 },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toBeInstanceOf(MultiYearError);
    const after = await loadMultiYear(userId, { client, now: LINKED });
    expect(after.retireYear).toBe(2040);
    expect(after.retireAssumed).toBe(false);
    expect(after.events).toHaveLength(1);
    const move = after.moves.find((m) => m.kind === "timing")!;
    expect(move.fromYear).toBe(2030);
    expect(move.year).toBeGreaterThan(2030);
    expect(move.effectCents).toBeGreaterThan(0);

    // Putting it on the plan adds a deadline, once, and moves no money.
    const transactions = await client.transaction.count({ where: { userId } });
    await putMoveOnPlan(userId, move.key, { client, now: LINKED, via: "page" });
    expect(await client.deadline.count({ where: { userId, title: move.title } })).toBe(1);
    expect(await client.transaction.count({ where: { userId } })).toBe(transactions);
    const done = await loadMultiYear(userId, { client, now: LINKED });
    expect(done.moves.map((m) => m.key)).not.toContain(move.key);
    await expect(
      putMoveOnPlan(userId, move.key, { client, now: LINKED, via: "page" }),
    ).rejects.toThrow("isn't on your list");

    await removePlanEvent(userId, after.events[0].id, { client });
    expect((await loadMultiYear(userId, { client, now: LINKED })).events).toEqual([]);
    await expect(removePlanEvent(userId, "nope", { client })).rejects.toBeInstanceOf(
      MultiYearError,
    );
  });

  it("assumes retirement at the long view's age when the investor profile has one", async () => {
    // /long-view retires them at RETIREMENT_AGE; /taxes/years agrees (docs/feature-audit.md,
    // cluster 12) instead of assuming "15 years from now".
    const userId = await person("years-age");
    await client.investorProfile.create({
      data: { userId, age: 50, ageOn: new Date("2026-01-01T00:00:00Z") },
    });
    const v = await loadMultiYear(userId, { client, now: LINKED });
    expect(v.retireAssumed).toBe(true);
    expect(v.retireYear).toBe(2026 + RETIREMENT_AGE - 50);
    expect(v.assumptions[1]).toBe(
      `You haven't told me when you plan to retire, so I assumed ${2026 + RETIREMENT_AGE - 50}.`,
    );
  });

  it("answers in the chat and to Claude", async () => {
    const userId = await person("years-chat");
    const { reply } = await sendToJane(userId, "I plan to retire in 2038", { client, now: LINKED });
    expect(reply.body).toMatch(
      /^Got it: you plan to retire in 2038\. Here is your federal tax over the next \d+ years\./,
    );
    const ask = await sendToJane(userId, "how do my taxes look over the next several years", {
      client,
      now: LINKED,
    });
    expect(ask.reply.body).toMatch(
      /^Here is your federal tax over the next \d+ years\.\n• 2026 \(your estimate\): \$/,
    );
    expect(ask.reply.body).toContain("2038 (when you retire)");
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_years", {}, { client, now: LINKED })).content,
    );
    expect(tool.years[0].year).toBe(2026);
    expect(tool.retireYear).toBe(2038);
    expect(tool.retireYearAssumed).toBe(false);
  });

  it("brings the best move up with a button, and the button puts it on the deadlines", async () => {
    const userId = await person("years-message");
    await addPlanEvent(
      userId,
      { kind: "withdrawal", year: 2030, amountCents: 8_000_000 },
      { client, now: LINKED, via: "chat" },
    );
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, {
        now: LINKED,
        local: { date: "2026-10-18", hour: 8 },
        trigger: "open",
      })
      .find((c) => c.dedupeKey.startsWith("years:"))!;
    expect(candidate.body).toMatch(/could save you about \$[\d,]+ of tax over the years\./);
    expect(candidate.refs.advice).toBe(true);
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
    const done = (
      await takeChatAction(userId, message.id, "tax.years_plan", { client, now: LINKED })
    ).message;
    expect(done.refs.note).toMatch(
      /^Done: ".+" is on your deadlines\. I move no money; carrying it out is yours\.$/,
    );
    expect(
      await client.deadline.count({
        where: { userId, title: { startsWith: "Take your withdrawal" } },
      }),
    ).toBe(1);
  });
});
