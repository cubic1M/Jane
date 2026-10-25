import { conciergeMode } from "@/lib/concierge-mode";
import { openPopupMessages, POPUP_LIMIT, stackedSuggestions } from "./messages";
import { timezoneOf } from "./open";
import { popupStack } from "./popups";
import { toView, type MessageView } from "./view";

// Jane's cards for one person, as the dock, Home and the chat show them (src/lib/jane-agent/
// popups.ts has the rules): the day's suggestions, then whatever else waits on them.
export async function loadPopupStack(userId: string): Promise<MessageView[]> {
  const [suggestions, zone, others, concierge] = await Promise.all([
    stackedSuggestions(userId),
    timezoneOf(userId),
    openPopupMessages(userId),
    conciergeMode(userId),
  ]);
  const now = new Date();
  return popupStack(
    suggestions.map((m) => toView(m, now, zone, { concierge })),
    others.map((m) => toView(m, now, zone, { concierge })),
    POPUP_LIMIT,
  );
}
