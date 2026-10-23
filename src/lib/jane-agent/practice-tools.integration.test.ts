import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));

import { adviceMode } from "@/lib/advice-mode";
import { logAudit } from "@/lib/audit";
import { startPractice } from "@/lib/practice/portfolio";
import { loadPreferences, practiceProfileOf, savePreferences } from "@/lib/practice/preferences";
import { applyPatch, DEFAULT_PREFERENCES } from "@/planning/practice-preferences";
import { ACTION_HANDLERS } from "./actions";
import { CHAT_TOOLS, runChatTool } from "./claude-tools";
import { PRACTICE_NOT_IN_ADVICE, proposePracticeChange } from "./practice-tools";
import { toolsFor } from "./tool-select";
import type { ChatMessage } from "./types";

// The practice settings in Jane's chat (Phase AW, Stage A), against a real Postgres: what people
// say becomes a card with the change in words, checked by the same rules as the settings page;
// nothing changes until the tap, which saves through savePreferences and the audit log.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-22T15:00:00Z");

describe("the practice settings tools go with the questions that need them", () => {
  it.each([
    "make it less risky",
    "stop the extra moves",
    "avoid oil companies",
    "I need this money in 2030",
    "use the trend strategy for my practice portfolio",
    "only index funds in my practice portfolio",
    "rebalance my practice portfolio less often",
  ])("%s", (q) => {
    const names = toolsFor(CHAT_TOOLS, q, null, null, "2026-10-22").map((t) => t.name);
    expect(names).toContain("change_practice_settings");
    expect(names).toContain("practice_settings");
  });

  it("not with a spending question", () => {
    const names = toolsFor(
      CHAT_TOOLS,
      "how much did I spend on groceries",
      null,
      null,
      "2026-10-22",
    );
    expect(names.map((t) => t.name)).not.toContain("change_practice_settings");
  });
});

describe.runIf(url)("practice settings in the chat", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `practice-chat-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await startPractice(user.id, 3, { client, now: NOW });
    return user.id;
  };
  const prefAudits = () =>
    vi.mocked(logAudit).mock.calls.filter((c) => c[1] === "practice_preferences_changed");
  const propose = (userId: string, input: object) =>
    proposePracticeChange(userId, input, { client, now: NOW });
  const tap = async (userId: string, refs: ChatMessage["refs"]) =>
    ACTION_HANDLERS["practice.prefs_save"].run({
      userId,
      message: { id: "m1", refs } as ChatMessage,
      action: { id: "practice.prefs_save", label: "Make the change", kind: "primary" },
      client,
      now: NOW,
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(() => {
    vi.mocked(logAudit).mockClear();
    vi.mocked(adviceMode).mockResolvedValue(true);
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it('"make it less risky" is one level lower, and changes nothing until the tap', async () => {
    const id = await person();
    const card = await propose(id, { risk_step: "lower" });
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.line).toContain("Risk level: From your answers → Low");
    expect(card.actions.map((a) => a.id)).toEqual(["practice.prefs_save", "open"]);
    expect((await loadPreferences(id, { client })).riskLevel).toBeNull();
    expect(prefAudits()).toEqual([]);

    const done = await tap(id, card.refs);
    expect(done.note).toMatch(/^Done\./);
    expect((await loadPreferences(id, { client })).riskLevel).toBe(2);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id },
      "practice_preferences_changed",
      { type: "user", id },
      { changed: "riskLevel", via: "chat", simulated: "true" },
    );
  });

  it('"stop the extra moves", "avoid oil companies" and "I need this money in 2030"', async () => {
    const id = await person();
    const off = await propose(id, { extra_moves: "off" });
    expect(off.ok && off.line).toContain("Extra moves: Normal → Off");
    const oil = await propose(id, { avoid_add: ["fossil_fuels"] });
    expect(oil.ok && oil.line).toContain("Never buy: Nothing → Oil, gas and coal companies");
    // Whole-market funds are said honestly.
    expect(oil.ok && oil.line).toMatch(/Whole-market index funds/);
    const goal = await propose(id, { goal_date: "2030" });
    expect(goal.ok && goal.line).toContain("When you need the money: None → January 1, 2030");
    if (!off.ok || !oil.ok || !goal.ok) return;
    await tap(id, off.refs);
    await tap(id, oil.refs);
    await tap(id, goal.refs);
    expect(await loadPreferences(id, { client })).toMatchObject({
      appetite: "off",
      avoid: ["fossil_fuels"],
      goalDate: "2030-01-01",
    });
    // Removing one keeps the rest.
    await savePreferences(id, { avoid: ["fossil_fuels", "tobacco"] }, "page", { client, now: NOW });
    const less = await propose(id, { avoid_remove: ["fossil fuels"] });
    expect(less.ok && less.refs.practicePrefs).toEqual({ avoid: ["tobacco"] });
  });

  it('"use the trend strategy", "trade less often", "only index funds", "at most half in one fund"', async () => {
    const id = await person();
    const card = await propose(id, {
      strategy: "trend",
      rebalance_pace: "rarely",
      universe: "funds_only",
      max_fund_percent: 50,
    });
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.line).toContain("Strategy: Jane's pick for your level → Trend filter");
    expect(card.line).toContain("How often to rebalance: Normal → Rarely");
    expect(card.line).toContain("What Jane may buy: Funds and a few big companies → Funds only");
    expect(card.line).toContain("Most in one fund: 80% (the limit) → 50%");
    await tap(id, card.refs);
    expect(await loadPreferences(id, { client })).toMatchObject({
      strategy: "trend",
      rebalancePace: "rarely",
      universe: "funds_only",
      maxFundPercent: 50,
    });
    const profile = await practiceProfileOf(id, { client, now: NOW });
    expect(profile.limits).toMatchObject({ rebalanceBand: 0.08, perEtfShare: 0.5 });
    expect(profile.strategy?.key).toBe("trend(months=6)");
    // Over the hard limit is refused, as on the page.
    const over = await propose(id, { max_fund_percent: 95 });
    expect(over).toEqual({ ok: false, error: "Pick a share from 20% to 80%." });
  });

  it("goes through the same check as the settings page", async () => {
    const id = await person();
    for (const [input, patch] of [
      [{ add_day: 31 }, { addDay: 31 }],
      [{ goal_date: "2020-01-01" }, { goalDate: "2020-01-01" }],
      [{ monthly_amount: -5 }, { monthlyAddCents: -500 }],
      [{ avoid_add: ["XOM"] }, { avoid: ["XOM"] }],
      [{ mode: "real" }, { mode: "real" }],
    ] as const) {
      const card = await propose(id, input);
      const page = applyPatch({ ...DEFAULT_PREFERENCES, avoid: [] }, patch, "2026-10-22");
      expect(card.ok).toBe(false);
      expect(page.ok).toBe(false);
      if (card.ok || page.ok) continue;
      expect(card.error).toBe(Object.values(page.errors).join(" "));
    }
    expect(await client.practicePreferences.count({ where: { userId: id } })).toBe(0);
  });

  it("refuses a change that changes nothing, and a tap that no longer passes", async () => {
    const id = await person();
    const same = await propose(id, { extra_moves: "normal" });
    expect(same.ok).toBe(false);
    await expect(tap(id, { practicePrefs: { addDay: 40 } })).rejects.toThrow(/can't be saved/);
    expect(prefAudits()).toEqual([]);
  });

  it("isn't there for real accounts", async () => {
    const id = await person();
    vi.mocked(adviceMode).mockResolvedValue(false);
    expect(await propose(id, { extra_moves: "off" })).toEqual({
      ok: false,
      error: PRACTICE_NOT_IN_ADVICE,
    });
    const read = await runChatTool(id, "practice_settings", {}, { client, now: NOW });
    expect(read.content).toContain(PRACTICE_NOT_IN_ADVICE);
  });

  it("reads the settings and what they make the autopilot do", async () => {
    const id = await person();
    await savePreferences(id, { mode: "suggest", cashBufferCents: 25_000 }, "page", {
      client,
      now: NOW,
    });
    const out = await runChatTool(id, "practice_settings", {}, { client, now: NOW });
    const body = JSON.parse(out.content);
    expect(body.label).toMatch(/Demo advice/);
    expect(body.settings.Autopilot).toBe("Suggest only");
    expect(body.settings["Cash to keep"]).toBe("$250");
    expect(body.what_the_autopilot_does.join(" ")).toMatch(/places no practice trades/);
    expect(out.cents).toContain(25_000);
  });
});
