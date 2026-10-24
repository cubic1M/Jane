import { landing } from "@/lib/area-pages/landing";
import type Anthropic from "@anthropic-ai/sdk";
import {
  STRATEGIST_EVERY_DAYS,
  STRATEGIST_LOOKUP_TOOLS,
  STRATEGIST_MAX_IDEAS,
  STRATEGIST_MAX_TOKENS,
  STRATEGIST_MAX_TURNS,
} from "@/config/strategist";
import type { Suggestion } from "@/detectors/contract";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic, chatModel, llmEnabled } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { dollarFigures } from "@/lib/guardrails";
import { addSpend, overDailyCap } from "@/lib/jane-agent/spend";
import { formatCents } from "@/lib/money";
import { vetIdea } from "@/planning/strategist";
import { detectFor } from "@/lib/suggestions";

// Claude as strategist (spec step 256). Once a week Claude reviews the person's whole profile
// and every detector's result with the registry's read-only tools and proposes combinations no
// single detector sees ("your March bonus: part to the HSA to cut tax, the rest to the 9% car
// loan"). It can't make anything appear on its own: each idea is vetted (src/planning
// /strategist.ts) before it joins the ranking: it must rest on at least two real suggestions,
// every dollar figure must come from a tool result, its words pass the guardrails (the
// demo_advice profile in advice mode) and it ends in those suggestions' buttons. Its
// confidence is the weakest suggestion it combines, never Claude's own say-so. Without a key
// nothing is proposed; past the day's cost cap it waits.

type Options = {
  client?: PrismaClient;
  now?: Date;
  // A fake in tests.
  claude?: () => Pick<Anthropic, "messages">;
  // Run even if it ran this week.
  force?: boolean;
};

export type StrategistResult =
  | { status: "no_key" | "not_due" | "capped" | "nothing_to_combine" }
  | { status: "ran"; kept: number; dropped: string[] };

const RUN_KEY = "strategist_run";
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

const SYSTEM = `You are Jane's money strategist, reviewing one person's whole picture once a week. Other checks have each looked at one thing and produced suggestions. Your job is to find combinations no single check sees: two to four of those suggestions that work better together, such as using one source of money for one need and the rest for another, or doing two things in one order.

Rules:
- Start with suggestions_now, then use the other tools to understand the person (my_profile, whole_picture, what_if and so on).
- Propose at most ${STRATEGIST_MAX_IDEAS} ideas, each with propose_idea, each resting on two or more suggestions by their exact key from suggestions_now. If nothing combines well, propose nothing: that is a good answer.
- Use only dollar amounts that appear in tool results, written exactly as they appear there. Never add, subtract, round or estimate amounts yourself.
- Never promise a result or a return. Say "could" and "about". No legal advice.
- Keep each title under one line and each explanation to two or three plain sentences about this person's own numbers.
- You can't do anything yourself. The person sees your idea with the buttons of the suggestions it rests on.`;

const SYSTEM_DEMO_ADVICE = `${SYSTEM}
- This person is using the demo bank with sample data, so you may say what you'd do about investments, taxes, insurance and loans. The app labels it as demo advice.`;

const SYSTEM_NO_ADVICE = `${SYSTEM}
- Don't give investment, tax or legal advice and don't mention investments, taxes or legal matters.`;

// A function, not a constant: the chat tools import (through the jobs) the controller that
// runs this, so they may not exist yet when this file is first read.
const strategistTools = (chatTools: Anthropic.Tool[]): Anthropic.Tool[] => [
  ...chatTools.filter((t) => STRATEGIST_LOOKUP_TOOLS.includes(t.name)),
  {
    name: "suggestions_now",
    description:
      "Every suggestion Jane's checks have for this person tonight, each with its key, what it is worth, how sure Jane is and why. Ideas are built from these keys.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_idea",
    description:
      "Offer one idea that combines two to four of the suggestions in suggestions_now. Returns whether it was accepted, or what to fix.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One line." },
        body: { type: "string", description: "Two or three plain sentences about their numbers." },
        based_on: {
          type: "array",
          items: { type: "string" },
          description: "The keys of the suggestions it combines, exactly as given.",
        },
      },
      required: ["title", "body", "based_on"],
      additionalProperties: false,
    },
  },
];

async function lastRun(userId: string, client: PrismaClient): Promise<string | null> {
  const row = await scopedFor(userId, client).janePreferences.findFirst({
    where: { kind: "system", key: RUN_KEY },
    select: { value: true },
  });
  const on = (row?.value as { on?: unknown } | null)?.on;
  return typeof on === "string" ? on : null;
}

async function markRun(userId: string, client: PrismaClient, now: Date) {
  await client.janePreference.upsert({
    where: { userId_kind_key: { userId, kind: "system", key: RUN_KEY } },
    create: {
      userId,
      kind: "system",
      key: RUN_KEY,
      value: { on: dayOf(now) },
      label: "Strategist",
    },
    update: { value: { on: dayOf(now) } },
  });
}

// What suggestions_now tells Claude, and the dollar figures that make allowed.
function suggestionsText(list: readonly Suggestion[]) {
  const cents: number[] = [];
  const rows = list.map((s) => {
    cents.push(s.worthCents, ...dollarFigures(s.why).map((f) => f.cents));
    return {
      key: s.id,
      what: s.title,
      worth: `${formatCents(s.worthCents)} (${s.worthKind === "risk" ? "a loss avoided" : s.worthKind === "earns" ? "a year, earned" : "a year, saved"})`,
      sureness: `${s.confidence.percent}%`,
      because: s.confidence.reason,
      why: s.why,
    };
  });
  return { content: JSON.stringify(rows), cents };
}

export async function runStrategist(
  userId: string,
  { client = defaultClient, now = new Date(), claude = anthropic, force = false }: Options = {},
): Promise<StrategistResult> {
  if (claude === anthropic && !llmEnabled()) return { status: "no_key" };
  if (!force) {
    const last = await lastRun(userId, client);
    if (last && now.getTime() - Date.parse(last) < STRATEGIST_EVERY_DAYS * DAY_MS) {
      return { status: "not_due" };
    }
  }
  if (await overDailyCap(userId, { client, now })) return { status: "capped" };
  // Loaded here, not at the top: the chat tools reach this file again through the jobs.
  const { CHAT_TOOLS, runChatTool } = await import("@/lib/jane-agent/claude-tools");
  const { suggestions, advice } = await detectFor(userId, { client, now });
  if (suggestions.length < 2) return { status: "nothing_to_combine" };
  const current = new Map(suggestions.map((s) => [s.id, s]));
  const shown = suggestionsText(suggestions);
  const allowedCents: number[] = [];
  const kept = new Map<string, Suggestion>();
  const dropped: string[] = [];
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Today is ${dayOf(now)}. Review this person and propose any combinations that work better together.`,
    },
  ];
  for (let turn = 0; turn < STRATEGIST_MAX_TURNS; turn += 1) {
    if (turn > 0 && (await overDailyCap(userId, { client, now }))) break;
    const response = await claude().messages.create({
      model: chatModel(),
      max_tokens: STRATEGIST_MAX_TOKENS,
      system: advice ? SYSTEM_DEMO_ADVICE : SYSTEM_NO_ADVICE,
      tools: strategistTools(CHAT_TOOLS),
      messages,
    });
    await addSpend(
      userId,
      {
        model: chatModel(),
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? 0,
      },
      { client, now },
    );
    if (response.stop_reason !== "tool_use") break;
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "suggestions_now") {
        allowedCents.push(...shown.cents);
        results.push({ type: "tool_result", tool_use_id: block.id, content: shown.content });
      } else if (block.name === "propose_idea") {
        const vetted =
          kept.size >= STRATEGIST_MAX_IDEAS
            ? ({ ok: false, reason: "That's enough ideas for this week." } as const)
            : vetIdea((block.input ?? {}) as Record<string, unknown>, {
                current,
                allowedCents,
                profile: advice ? "demo_advice" : "standard",
              });
        if (vetted.ok && !kept.has(vetted.idea.id)) kept.set(vetted.idea.id, vetted.idea);
        else if (!vetted.ok) dropped.push(vetted.reason);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: vetted.ok ? "Accepted." : vetted.reason,
          ...(vetted.ok ? {} : { is_error: true }),
        });
      } else if (STRATEGIST_LOOKUP_TOOLS.includes(block.name)) {
        const out = await runChatTool(userId, block.name, block.input, { client, now });
        allowedCents.push(...out.cents, ...dollarFigures(out.content).map((f) => f.cents));
        results.push({ type: "tool_result", tool_use_id: block.id, content: out.content });
      } else {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "That tool isn't available here.",
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
  // Ideas wait in the same table as any suggestion, tagged by their capability.
  for (const idea of kept.values()) {
    const data = {
      capability: idea.capability,
      topic: idea.topic,
      title: idea.title,
      worthCents: idea.worthCents,
      worthKind: idea.worthKind,
      confidencePercent: idea.confidence.percent,
      confidenceReason: idea.confidence.reason,
      urgency: idea.urgency,
      why: idea.why,
      actionLabel: idea.action.label,
      actionHref: landing(idea.action.href),
      lastSeenAt: now,
    };
    const have = await scopedFor(userId, client).suggestions.findFirst({
      where: { key: idea.id },
      select: { status: true },
    });
    if (have?.status === "yes" || have?.status === "no") continue;
    await client.suggestion.upsert({
      where: { userId_key: { userId, key: idea.id } },
      create: { userId, key: idea.id, ...data },
      update: { ...data, status: "waiting" },
    });
  }
  await markRun(userId, client, now);
  return { status: "ran", kept: kept.size, dropped };
}
