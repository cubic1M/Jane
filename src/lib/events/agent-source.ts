import { EVENT_EVIDENCE } from "@/config/event-evidence";
import { EVENT_FRESH_DAYS, EVENT_HOLD_DAYS } from "@/config/events";
import type { RiskLevel } from "@/config/investing";
import { adviceMode } from "@/lib/advice-mode";
import { scopedFor } from "@/lib/db-scoped";
import { registerAgentSignals, type AgentSignalSource } from "@/lib/trading-agent/agent";
import { eventAgentSignals } from "@/planning/event-agent-signals";
import type { ClosedSlice } from "@/planning/event-overlay";
import { toEvent } from "./rows";

// The events overlay as a signal source for the 24-hour trading agent (src/lib/trading-agent/
// agent.ts): for a paper account the agent runs, with the overlay switched on, the overlay's
// slices for the bars the agent is catching up on (src/planning/event-agent-signals.ts). Only
// events public by the end of that range are read, so nothing is traded on before it was known.
// The overlay's funds are US funds: the agent on crypto gets none. Advice mode only. Registered
// once when this module loads (src/lib/paper/account.ts imports it).

const DAY_MS = 86_400_000;

export const eventsAgentSource: AgentSignalSource = async (
  userId,
  { client, from, to, market },
) => {
  if (market !== "stocks") return [];
  const db = scopedFor(userId, client);
  const overlay = await db.paperEventOverlays.findFirst({});
  if (!overlay?.on) return [];
  const account = await db.paperAccounts.findFirst({ select: { id: true, level: true } });
  if (!account || account.id !== overlay.accountId) return [];
  if (!(await adviceMode(userId, { client }))) return [];
  // A slice runs EVENT_HOLD_DAYS trading days: events up to about six weeks before the range can
  // still be in force; none from before the overlay was switched on (less the fresh window).
  const earliest = Math.max(
    Date.parse(from) - (EVENT_HOLD_DAYS * 7 * DAY_MS) / 5 - 7 * DAY_MS,
    overlay.switchedAt.getTime() - EVENT_FRESH_DAYS * DAY_MS,
  );
  const rows = await client.marketEvent.findMany({
    where: { knownAt: { lte: new Date(to), gte: new Date(earliest) } },
    orderBy: { knownAt: "asc" },
  });
  const closed = ((overlay.state ?? {}) as { closed?: ClosedSlice[] }).closed ?? [];
  return eventAgentSignals(rows.map(toEvent), {
    level: account.level as RiskLevel,
    seed: EVENT_EVIDENCE,
    closed,
  }).filter((s) => s.at <= to && (s.until ?? "9999") > from);
};

registerAgentSignals(eventsAgentSource);
