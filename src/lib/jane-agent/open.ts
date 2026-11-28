import { conciergeMode } from "@/lib/concierge-mode";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { chatFeed, closeSettled, visibleCount } from "./messages";
import { CHAT_KINDS } from "./popups";
import { SCANNING_HELLO } from "@/config/scan";
import { scanInProgress } from "@/lib/scan";
import { timezoneOf } from "@/lib/today";
import { runState, turnOwed, type OpenRun } from "./open-run";
import { toView, type MessageView } from "./view";

// Opening the chat (spec step 81). It opens at once on what is stored. With nothing posted yet
// today (or the person talking since), Jane's brain is owed a turn, which the page runs after the
// response (`run`, src/lib/jane-agent/open-run.ts; quiet hours don't apply, the person is looking)
// and the open page picks up what it posts. Null when the person has no accounts yet, like
// Today. With `since`, only what came after this sign-in (src/lib/chat-start.ts).

// The scan's old "still going through your accounts" message, posted before it was removed:
// never shown.
const notTheOldHello = (m: { kind: string; body: string }) =>
  !(m.kind === "brief" && m.body === SCANNING_HELLO);

export async function openChat(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    pages = 1,
    since,
  }: { client?: PrismaClient; now?: Date; pages?: number; since?: Date } = {},
): Promise<{
  messages: MessageView[];
  hasEarlier: boolean;
  scanning: boolean;
  // Jane's turn: "owed" (the page tells the browser it is on screen, which starts it), or "settled".
  run: OpenRun;
  // While scanning or a turn is out: every message the pulse counts, cards included, which the
  // chat's refresher compares with its own count (the feed holds only the chat's kinds).
  pulseCount: number;
} | null> {
  if ((await scopedFor(userId, client).accounts.count()) === 0) return null;
  const [timezone, concierge] = await Promise.all([
    timezoneOf(userId, { client }),
    conciergeMode(userId, { client }),
  ]);
  // The first scan is still running (the sample person's, or a bank just linked): the chat
  // opens at once with what's there, instead of waiting for the whole run; the scan's own run
  // posts its findings as it finishes, and the page's loading bar (src/components/scan-bar.tsx)
  // says how far it has got. No "still going through your accounts" message (founder: "remove
  // this one from the chat").
  const scanning = await scanInProgress(userId, { client, now });
  if (scanning) {
    const [feed, pulseCount] = await Promise.all([
      chatFeed(userId, { client, pages, now, since, kinds: CHAT_KINDS }),
      visibleCount(userId, { client, now, since }),
    ]);
    return {
      messages: feed.messages
        .filter(notTheOldHello)
        .map((m) => toView(m, now, timezone, { concierge })),
      hasEarlier: feed.hasEarlier,
      scanning: true,
      run: "settled",
      pulseCount,
    };
  }
  // Jane looks again on the first visit of the day, and (spec step 92) after a
  // conversation, when what it held back while the person was typing can come.
  const { owed, typedAt } = await turnOwed(userId, { client, now }, timezone);
  if (!owed) await closeSettled(userId, { client, now });
  const run: OpenRun = await runState(userId, { client, now }, { timezone, typedAt, owed });
  const [feed, pulseCount] = await Promise.all([
    chatFeed(userId, { client, pages, now, since, kinds: CHAT_KINDS }),
    run === "settled" ? 0 : visibleCount(userId, { client, now, since }),
  ]);
  return {
    messages: feed.messages
      .filter(notTheOldHello)
      .map((m) => toView(m, now, timezone, { concierge })),
    hasEarlier: feed.hasEarlier,
    scanning: false,
    run,
    pulseCount,
  };
}
