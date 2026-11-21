import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { conciergeMode } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { openPopupMessages, POPUP_LIMIT, stackedSuggestions } from "./messages";
import { timezoneOf } from "@/lib/today";
import { popupStack } from "./popups";
import { saidByPicks } from "./same-matter";
import type { ChatMessage } from "./types";
import { stillTrue } from "./still-true";
import { toView, type MessageView } from "./view";

// Jane's cards for one person, as the dock, Home and the chat show them (src/lib/jane-agent/
// popups.ts has the rules): the day's suggestions, then whatever else waits on them.
export async function loadPopupStack(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<MessageView[]> {
  const [suggestions, zone, posted, concierge] = await Promise.all([
    stackedSuggestions(userId, { client, now }),
    timezoneOf(userId, { client }),
    openPopupMessages(userId, { client, now }),
    conciergeMode(userId, { client }),
  ]);
  const others = await notAskedByPicks(userId, suggestions, posted, client);
  // Each card checked against the data now, and said as of today (./still-true.ts).
  const current = new Map(
    (await stillTrue(userId, [...suggestions, ...others], { client, now })).map((m) => [m.id, m]),
  );
  const shown = (list: typeof others) =>
    list.flatMap((m) => current.get(m.id) ?? []).map((m) => toView(m, now, zone, { concierge }));
  const [first, rest] = [
    shown(suggestions),
    shown(oneCardAFinding(others.filter((m) => current.has(m.id)))),
  ];
  // Advice stored while the person only had the demo bank, once a real account has joined: gone from
  // the cards at once, before the chat next opens and closes the message (./settled.ts).
  const adviceAllowed =
    ![...first, ...rest].some((m) => m.advice) || (await adviceMode(userId, { client }));
  const allowed = (list: MessageView[]) => (adviceAllowed ? list : list.filter((m) => !m.advice));
  return popupStack(allowed(first), allowed(rest), POPUP_LIMIT);
}

// A finding Jane posted that one of the day's picks already asks, the same matter about the same
// merchant (./same-matter.ts), waits behind the pick: it's still open, and back once the pick goes.
async function notAskedByPicks(
  userId: string,
  picks: readonly ChatMessage[],
  posts: ChatMessage[],
  client: PrismaClient,
): Promise<ChatMessage[]> {
  const keys = picks.flatMap((m) => m.refs.suggestion ?? []);
  const findingIds = posts.flatMap((m) => m.refs.findingId ?? []);
  if (keys.length === 0 || findingIds.length === 0) return posts;
  const db = scopedFor(userId, client);
  const [rows, findings] = await Promise.all([
    db.suggestions.findMany({ where: { key: { in: keys } }, select: { topic: true, watch: true } }),
    db.findings.findMany({
      where: { id: { in: findingIds } },
      select: { id: true, type: true, evidence: true },
    }),
  ]);
  const said = saidByPicks(
    rows,
    findings.map((f) => ({
      id: f.id,
      type: f.type,
      merchant: (f.evidence as { merchant?: unknown } | null)?.merchant,
    })),
  );
  return posts.filter((m) => !said.has(m.refs.findingId ?? ""));
}

// One card a finding (debug 3, 11-21: a linked month's dock had Dec 9's "Review your Audible
// subscription" and Dec 15's "Audible is a new regular charge", which carries the same finding, so
// one Yes twice). The newest still true says it (they come newest first); the other waits, open.
function oneCardAFinding(posts: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return posts.filter((m) => {
    const id = m.refs.findingId;
    if (id === undefined) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
