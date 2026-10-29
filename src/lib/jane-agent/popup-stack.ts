import type { PrismaClient } from "@/generated/prisma/client";
import { conciergeMode } from "@/lib/concierge-mode";
import { db as defaultClient } from "@/lib/db";
import { openPopupMessages, POPUP_LIMIT, stackedSuggestions } from "./messages";
import { timezoneOf } from "./open";
import { popupStack } from "./popups";
import { stillTrue } from "./still-true";
import { toView, type MessageView } from "./view";

// Jane's cards for one person, as the dock, Home and the chat show them (src/lib/jane-agent/
// popups.ts has the rules): the day's suggestions, then whatever else waits on them.
export async function loadPopupStack(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<MessageView[]> {
  const [suggestions, zone, others, concierge] = await Promise.all([
    stackedSuggestions(userId, { client, now }),
    timezoneOf(userId, { client }),
    openPopupMessages(userId, { client, now }),
    conciergeMode(userId, { client }),
  ]);
  // Each card checked against the data now, and said as of today (./still-true.ts).
  const current = new Map(
    (await stillTrue(userId, [...suggestions, ...others], { client, now })).map((m) => [m.id, m]),
  );
  const shown = (list: typeof others) => list.flatMap((m) => current.get(m.id) ?? []);
  return popupStack(
    shown(suggestions).map((m) => toView(m, now, zone, { concierge })),
    shown(others).map((m) => toView(m, now, zone, { concierge })),
    POPUP_LIMIT,
  );
}
