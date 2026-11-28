import { CHAT_MODEL_DOWN_LOG_MINUTES } from "@/config/chat-model";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { log } from "@/lib/log";
import { recordOpsEvent } from "@/lib/ops-alerts";
import { openLink } from "./types";
import type { Reply } from "./replies";

// When Claude can't be reached (the key refused, the provider down, no answer in time), the person
// is told so, in plain words, and the team is told too. "Please ask again" never stands in for it:
// asking again changes nothing until someone fixes the cause (founder 11-28: a refused key
// answered a plain question about a purchase with "Sorry, I couldn't finish an answer").

// The reasons (askClaude's `fail` codes) that mean Claude itself isn't answering, not a cap, a
// block or an empty answer.
const DOWN_REASONS = new Set(["api_error", "key_refused", "cooldown", "too_slow", "no_time"]);
export const claudeIsDown = (reason: string | undefined): boolean =>
  reason !== undefined && DOWN_REASONS.has(reason);

export const SERVICE_DOWN_TEXT =
  "Jane's answering service isn't available right now. It has been reported to the team and your numbers are all still here.";

// The words after "from / at / to / with / for" in a question about buying or paying somewhere:
// "did I buy something from california arts before" gives "california arts".
const PLACE =
  /\b(?:bought|buy|purchase[ds]?|spent|spend|paid|pay|ordered?|order|charged?|shop(?:ped)?|subscribed?)\b[^?]*?\b(?:from|at|to|with|for|on)\s+([A-Za-z0-9&'.\- ]{2,40}?)(?:\s+(?:before|ever|last|this|in|on|yesterday|today|recently|again|since|during|over)\b|[?.!,]|$)/i;

export function merchantAsked(text: string): string | null {
  const found = PLACE.exec(text)?.[1]
    ?.trim()
    .replace(/^(?:the|a|an|my)\s+/i, "");
  return found && found.length >= 2 ? found : null;
}

// The reply for a question Claude couldn't be asked: the plain line, and, when the question names
// a place, the transactions page already searched for it, where the same data can be seen.
export function serviceDownReply(question: string): Reply {
  const place = merchantAsked(question);
  return {
    body: place
      ? `${SERVICE_DOWN_TEXT} You can look for ${place} yourself on your transactions page.`
      : SERVICE_DOWN_TEXT,
    actions: place
      ? [openLink("Search your transactions", `/transactions?q=${encodeURIComponent(place)}`)]
      : [],
    refs: {},
  };
}

// Logged once per window on this server, and recorded as an ops event: /admin/health shows the
// count as a red line, and the daily email counts it (src/lib/chat-model-health.ts). A refused
// key already raises its own alarm at the call itself (src/lib/anthropic.ts, claude_key_refused).
let lastLogged = 0;
export async function noteChatModelDown(
  reason: string,
  {
    userId,
    client = defaultClient,
    now = new Date(),
  }: { userId: string; client?: PrismaClient; now?: Date },
): Promise<void> {
  if (now.getTime() - lastLogged >= CHAT_MODEL_DOWN_LOG_MINUTES * 60_000) {
    lastLogged = now.getTime();
    log.error("chat_model_unavailable", { reason });
  }
  await recordOpsEvent("chat_model_unavailable", {
    code: reason.toUpperCase(),
    userId,
    client,
    now,
  });
}

// For tests.
export function resetChatModelDownLog() {
  lastLogged = 0;
}
