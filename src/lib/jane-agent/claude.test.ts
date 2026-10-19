import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/home", () => ({ homeSummary: vi.fn() }));
vi.mock("./snapshot", () => ({ loadSnapshot: vi.fn() }));

import { CHAT_CLAUDE_MAX_TURNS } from "@/config/agent-chat";
import { ASK_BLOCKED_REPLY } from "@/config/ask";
import type { PrismaClient } from "@/generated/prisma/client";
import { homeSummary } from "@/lib/home";
import { CHAT_UNAVAILABLE_TEXT, askClaudeInChat } from "./claude";
import { CHAT_TOOLS, proposeAction } from "./claude-tools";
import { loadSnapshot, type Snapshot } from "./snapshot";

// Spec step 84: free questions go to Claude with read-only tools over the person's own data
// (here a fake client). A tool call works; propose_action only offers buttons from the
// registry, never runs one; a guardrail failure falls back to safe text with no buttons;
// and the turn limit holds.

const NOW = new Date("2026-10-18T15:00:00Z");
const client = {} as PrismaClient;
const create = vi.fn();
// What each request sent, as it was then (the loop keeps adding to one array).
const sent: { role: string; content: unknown }[][] = [];
const claude = () =>
  ({
    messages: {
      create: (params: { messages: { role: string; content: unknown }[] }) => {
        sent.push(structuredClone(params.messages));
        return create(params);
      },
    },
  }) as never;
const options = { client, now: NOW, claude };

let ids = 0;
const toolUse = (name: string, input: object = {}) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: `t${++ids}`, name, input }],
});
const final = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

const snapshot = {
  timezone: "America/Los_Angeles",
  findings: [
    {
      findingId: "f1",
      type: "subscription_review",
      title: "Review your Hulu subscription",
      annualSavingsCents: 21_588,
      savings: "Could save about $215.88 a year",
      fingerprint: "fp1",
      urgent: false,
      pick: null,
    },
  ],
  plan: { items: 1, annualSavingsCents: 21_588, safeItems: 0 },
} as unknown as Snapshot;

const lastToolResult = (call: number) =>
  (sent[call].at(-1)!.content as { content: string; is_error?: boolean }[])[0];

describe("askClaudeInChat", () => {
  beforeEach(() => {
    create.mockReset();
    sent.length = 0;
    vi.mocked(loadSnapshot).mockReset().mockResolvedValue(snapshot);
    vi.mocked(homeSummary).mockReset();
  });

  it("answers with a read-only tool, using only figures it returned", async () => {
    vi.mocked(homeSummary).mockResolvedValue({
      safeToSpend: {
        safeCents: 123_456,
        payday: "2026-10-30",
        balanceCents: 300_000,
        billsCents: 50_000,
        budgetsLeftCents: 0,
        goalsCents: 0,
        setAsideCents: 0,
      },
    } as never);
    create
      .mockResolvedValueOnce(toolUse("safe_to_spend"))
      .mockResolvedValueOnce(final("You have $1,234.56 to spend until Oct 30."));

    const result = await askClaudeInChat("u1", [], "Is a dinner out OK this week?", options);

    expect(result).toEqual({
      kind: "answer",
      reply: { body: "You have $1,234.56 to spend until Oct 30.", actions: [], refs: {} },
    });
    expect(homeSummary).toHaveBeenCalledWith("u1", { client, now: NOW });
    expect(JSON.parse(lastToolResult(1).content)).toMatchObject({
      safeToSpend: "$1,234.56",
      until: "2026-10-30",
    });
    // The same model settings as Ask, with the chat's tools.
    expect(create.mock.calls[0][0]).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      tools: CHAT_TOOLS,
    });
  });

  it("puts a proposed finding's Yes and No under the answer, without acting", async () => {
    create
      .mockResolvedValueOnce(toolUse("propose_action", { action: "finding.yes", finding_id: "f1" }))
      .mockResolvedValueOnce(final("Hulu is on your list. Tap Yes if you'd like me to cancel it."));

    const result = await askClaudeInChat("u1", [], "I never watch Hulu", options);

    expect(result.kind).toBe("answer");
    expect(result.reply.actions.map((a) => a.id)).toEqual(["finding.yes", "finding.no", "open"]);
    expect(result.reply.refs).toEqual({ findingId: "f1", fingerprint: "fp1" });
    // Jane's own wording for the finding follows Claude's text.
    expect(result.reply.body).toMatch(/\n\nReview your Hulu subscription\. Could save about/);
    expect(lastToolResult(1)).toMatchObject({
      content: "The button will be shown under your answer.",
    });
  });

  it("refuses anything outside the registry or not Claude's to offer", async () => {
    create
      .mockResolvedValueOnce(toolUse("propose_action", { action: "finding.delete" }))
      .mockResolvedValueOnce(toolUse("propose_action", { action: "undo.rule" }))
      .mockResolvedValueOnce(toolUse("propose_action", { action: "finding.yes", finding_id: "x" }))
      .mockResolvedValueOnce(final("I can't do that from here."));

    const result = await askClaudeInChat("u1", [], "Delete it", options);

    expect(result).toEqual({
      kind: "answer",
      reply: { body: "I can't do that from here.", actions: [], refs: {} },
    });
    expect(lastToolResult(1)).toMatchObject({ is_error: true });
    expect(lastToolResult(1).content).toMatch(/isn't an action you can offer/);
    expect(lastToolResult(2).content).toMatch(/isn't an action you can offer/);
    expect(lastToolResult(3).content).toBe("That isn't one of the person's open findings.");
  });

  it("offers one button per answer", async () => {
    create
      .mockResolvedValueOnce(toolUse("propose_action", { action: "open", page: "goals" }))
      .mockResolvedValueOnce(toolUse("propose_action", { action: "open", page: "plan" }))
      .mockResolvedValueOnce(final("Your goals are on the goals page."));
    const result = await askClaudeInChat("u1", [], "Goals?", options);
    expect(result.reply.actions).toEqual([
      { id: "open", kind: "link", label: "See goals", href: "/goals" },
    ]);
    expect(lastToolResult(2).content).toBe("You already offered a button for this answer.");
  });

  it("falls back to safe text, with no buttons, when the guardrails refuse", async () => {
    create
      .mockResolvedValueOnce(toolUse("propose_action", { action: "finding.yes", finding_id: "f1" }))
      .mockResolvedValueOnce(final("Cancel Hulu and put the money in an index fund."));
    const result = await askClaudeInChat("u1", [], "What should I do?", options);
    expect(result).toEqual({
      kind: "blocked",
      reply: { body: ASK_BLOCKED_REPLY, actions: [], refs: {} },
      issues: ["investment_advice"],
    });

    create.mockResolvedValueOnce(final("You'll save $5,000.00 a year."));
    expect(await askClaudeInChat("u1", [], "How much?", options)).toMatchObject({
      kind: "blocked",
      issues: ["unsupported_dollar_figure", "guaranteed_outcome"],
    });
  });

  it("stops at the turn limit", async () => {
    create.mockResolvedValue(toolUse("safe_to_spend"));
    vi.mocked(homeSummary).mockResolvedValue(null);
    const result = await askClaudeInChat("u1", [], "Hi", options);
    expect(result).toEqual({
      kind: "unavailable",
      reply: { body: CHAT_UNAVAILABLE_TEXT, actions: [], refs: {} },
    });
    expect(create).toHaveBeenCalledTimes(CHAT_CLAUDE_MAX_TURNS);

    create.mockClear();
    await askClaudeInChat("u1", [], "Hi", { ...options, maxTurns: 2 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("is unavailable on an API error or a refusal", async () => {
    create.mockRejectedValueOnce(new Anthropic.APIError(500, undefined, "boom", new Headers()));
    expect((await askClaudeInChat("u1", [], "Hi", options)).kind).toBe("unavailable");
    create.mockResolvedValueOnce({ stop_reason: "refusal", content: [] });
    expect((await askClaudeInChat("u1", [], "Hi", options)).kind).toBe("unavailable");
  });

  it("sends recent messages only, starting with the person's, one turn per side", async () => {
    create.mockResolvedValueOnce(final("Sure."));
    await askClaudeInChat(
      "u1",
      [
        { role: "assistant", content: "Good morning!" },
        { role: "user", content: "hi" },
        { role: "user", content: "netflix?" },
        { role: "assistant", content: "Netflix charged $15.49." },
      ],
      "and hulu?",
      options,
    );
    expect(sent[0]).toEqual([
      { role: "user", content: "hi\n\nnetflix?" },
      { role: "assistant", content: "Netflix charged $15.49." },
      { role: "user", content: "and hulu?" },
    ]);
  });
});

describe("proposeAction", () => {
  beforeEach(() => {
    vi.mocked(loadSnapshot).mockReset().mockResolvedValue(snapshot);
  });
  const propose = (input: unknown) => proposeAction("u1", input, { client, now: NOW });

  it("offers a goal only with a name, an amount and a month in the next 12", async () => {
    expect(
      await propose({
        action: "goal.start",
        goal_name: "Trip",
        goal_amount: 900,
        goal_month: "2027-03",
      }),
    ).toEqual({
      ok: true,
      actions: [{ id: "goal.start", label: "Start a goal for it", kind: "primary" }],
      refs: { goal: { name: "Trip", targetCents: 90_000, targetDate: "2027-03-01" } },
      line: "The goal: Trip, $900.00 by March 2027.",
    });
    for (const bad of [
      { goal_name: "", goal_amount: 900, goal_month: "2027-03" },
      { goal_name: "Trip", goal_amount: -5, goal_month: "2027-03" },
      { goal_name: "Trip", goal_amount: 900, goal_month: "2026-10" },
      { goal_name: "Trip", goal_amount: 900, goal_month: "2029-01" },
    ]) {
      expect((await propose({ action: "goal.start", ...bad })).ok).toBe(false);
    }
  });

  it("offers the plan's safe ones only when there are some, and only known pages", async () => {
    expect((await propose({ action: "plan.approve_safe" })).ok).toBe(false);
    vi.mocked(loadSnapshot).mockResolvedValue({
      ...snapshot,
      plan: { items: 3, annualSavingsCents: 0, safeItems: 2 },
    });
    expect(await propose({ action: "plan.approve_safe" })).toMatchObject({ ok: true });
    expect((await propose({ action: "open", page: "https://evil.example" })).ok).toBe(false);
    expect((await propose({ action: "autopilot.pause" })).ok).toBe(false);
    expect((await propose(null)).ok).toBe(false);
  });
});
