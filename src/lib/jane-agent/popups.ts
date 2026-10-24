import type { FloatingCardData } from "@/lib/floating-cards";
import type { MessageView } from "./view";

// Jane's own messages as pop-ups (founder: "replace all the yellow cards in the chat as pop up
// ones that do not take any space in the chat area ... very concise and easy and direct to
// understand, with users having the ability to click more details to see more"). Anything Jane
// brings up that waits on the person (a suggestion, something to decide, a heads-up with a
// button) floats over the page as a card and never sits in the chat's list while it's open;
// once answered it's in the list again as one line of history. Pure, so the rules are tested.

// A card's headline: this many words at most.
export const POPUP_HEADLINE_WORDS = 8;

// Waiting on the person, so it floats: from Jane (not an answer to what they typed), open, with
// a button to tap. Options of one choice float as their own pick card.
export function isPopup(m: MessageView): boolean {
  return (
    m.fromJane &&
    m.kind !== "reply" &&
    m.status === "open" &&
    !m.options &&
    m.buttons.some((b) => !b.id.startsWith("undo."))
  );
}

// The order they float in, after the day's suggestions: the day's brief first (the agenda, the
// greeting), then the rest newest first.
export function popupOrder(popups: readonly MessageView[]): MessageView[] {
  return [...popups.filter((m) => m.kind === "brief"), ...popups.filter((m) => m.kind !== "brief")];
}

// The chat's list without what's floating: no gaps, no placeholders.
export function withoutPopups(
  messages: readonly MessageView[],
  popups: readonly MessageView[],
): MessageView[] {
  const floating = new Set(popups.map((p) => p.id));
  return messages.filter((m) => !floating.has(m.id));
}

// The first line, cut to a few words at a word boundary.
export function concise(text: string, max = POPUP_HEADLINE_WORDS): string {
  const first = text.split("\n")[0].trim();
  const words = first.split(/\s+/);
  if (words.length <= max) return first;
  return `${words
    .slice(0, max)
    .join(" ")
    .replace(/[,;:.!?—-]+$/, "")}…`;
}

// A message that isn't one of the day's suggestions, as a card: its first line as a short
// headline, the main button as Yes, the other buttons as choices behind More details, and the
// whole message there too when the headline had to be cut.
export type PopupCard = FloatingCardData & {
  // What Yes taps, and what Not now taps (null: Not now only puts it off on this screen).
  yesAction: string;
  notNowAction: string | null;
  choices: { id: string; label: string }[];
};

export function popupCard(m: MessageView): PopupCard {
  const live = m.buttons.filter((b) => !b.id.startsWith("undo."));
  const snooze = live.find((b) => b.id === "snooze") ?? null;
  const rest = live.filter((b) => b !== snooze);
  const main = rest.find((b) => b.kind === "primary") ?? rest[0] ?? snooze!;
  const headline = concise(m.body);
  const full = m.body.trim();
  const more = headline === full.split("\n")[0].trim() ? full.split("\n").slice(1).join(" ") : full;
  return {
    id: m.id,
    headline,
    details: {
      about: more.trim() || undefined,
      notes: m.advice ? ["Demo advice: sample data, not financial advice"] : undefined,
    },
    yesLabel: main.label,
    notNowLabel: snooze?.label ?? "Not now",
    yesAction: main.id,
    notNowAction: snooze?.id ?? null,
    choices: rest.filter((b) => b !== main).map((b) => ({ id: b.id, label: b.label })),
    noNever: true,
  };
}
