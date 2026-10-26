import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { loadEventsView } from "@/lib/events/view";

// Claude's tool for the events overlay in Jane's chat (founder, 2026-10-26): what the Events box
// shows, from what is stored, so "what is the events thing doing?" gets the real answer. Read only:
// the switch is on the investments page. Demo advice only; a real account gets a note.

export const EVENTS_TOOLS: Anthropic.Tool[] = [
  {
    name: "events_overlay",
    description:
      "The events overlay on the person's paper account (simulated money): whether it is on, the events of the last few days (each with what it would do or did and how sure, as a percent), its open slices, its recent actions with the event that set each off, and each event type's track record, plus how it did in the backtest (it made no clear difference there). Never predict a price; say it is simulated and demo advice.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
];

export const isEventsTool = (name: string) => EVENTS_TOOLS.some((t) => t.name === name);

export const EVENTS_NOT_IN_ADVICE =
  "The events overlay is part of the paper account, which runs for demo accounts only. This person's accounts are real, so there is nothing to show.";

export async function runEventsTool(
  userId: string,
  _name: string,
  _input: unknown,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ToolOutput> {
  const view = await loadEventsView(userId, { client, now });
  if (!view) return { content: JSON.stringify({ note: EVENTS_NOT_IN_ADVICE }), cents: [] };
  return {
    content: JSON.stringify({
      label: view.label,
      on: view.on,
      hasPaperAccount: view.hasAccount,
      happeningNow: view.now.map((e) => ({
        date: e.date,
        event: e.label,
        what: e.title,
        source: e.source,
        plan: e.plan,
        confidencePercent: e.confidence,
      })),
      openSlices: view.open,
      recent: view.recent.map((r) => ({
        date: r.date,
        kind: r.kind,
        ticker: r.ticker,
        why: r.reason,
      })),
      record: view.record,
      backtest: view.backtest,
    }),
    cents: [],
  };
}
