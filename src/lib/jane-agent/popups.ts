import type { FloatingCardData } from "@/lib/floating-cards";
import { GREETING_START, MORNING_BRIEF } from "@/config/agent-chat";
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

// The morning brief is off for now (MORNING_BRIEF): a greeting already posted shows nowhere.
export function hiddenBrief(m: Pick<MessageView, "kind" | "body">, on = MORNING_BRIEF): boolean {
  return !on && m.kind === "brief" && GREETING_START.test(m.body.trim());
}

// One stack of cards (founder: "don't let the suggestion cards repeat"): the day's suggestions,
// then the other pop-ups in their order, up to `limit`; one card per message and per headline,
// so a finding a source also posted as a decision shows once.
export function popupStack(
  suggestions: readonly MessageView[],
  others: readonly MessageView[],
  limit: number,
): MessageView[] {
  const seenIds = new Set<string>();
  const seenHeadlines = new Set<string>();
  const out: MessageView[] = [];
  const add = (m: MessageView) => {
    const headline = m.body.split("\n")[0].trim().toLowerCase();
    if (seenIds.has(m.id) || seenHeadlines.has(headline)) return false;
    seenIds.add(m.id);
    seenHeadlines.add(headline);
    out.push(m);
    return true;
  };
  for (const m of suggestions) add(m);
  let extra = 0;
  for (const m of popupOrder(
    others.filter((o) => isPopup(o) && !o.suggestion && !hiddenBrief(o)),
  )) {
    if (extra >= limit) break;
    if (add(m)) extra += 1;
  }
  return out;
}

// The chat's list (founder: the cards are "right above the chat ... but not in the chat"): no
// suggestion at all, waiting or answered, and nothing that's floating; no gaps, no placeholders.
export function chatList(
  messages: readonly MessageView[],
  stack: readonly MessageView[],
): MessageView[] {
  const floating = new Set(stack.map((p) => p.id));
  const headlines = new Set(stack.map((p) => p.body.split("\n")[0].trim().toLowerCase()));
  return messages.filter(
    (m) =>
      !m.suggestion &&
      !hiddenBrief(m) &&
      !floating.has(m.id) &&
      !(
        m.status === "open" &&
        m.fromJane &&
        headlines.has(m.body.split("\n")[0].trim().toLowerCase())
      ),
  );
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

// The first sentence of the first line, whole.
export function firstSentence(text: string): string {
  const first = text.trim().split("\n")[0].trim();
  const end = /[.!?](?=\s+\S)/.exec(first);
  return end ? first.slice(0, end.index + 1) : first;
}

export function popupCard(m: MessageView): PopupCard {
  const live = m.buttons.filter((b) => !b.id.startsWith("undo."));
  const snooze = live.find((b) => b.id === "snooze") ?? null;
  const rest = live.filter((b) => b !== snooze);
  const main = rest.find((b) => b.kind === "primary") ?? rest[0] ?? snooze!;
  // Its first sentence in full, never cut short (founder: "slightly bigger so that the info
  // isn't all gone"); the rest of the message behind More details.
  const headline = firstSentence(m.body);
  const full = m.body.trim();
  // Its lines kept: each is a paragraph behind More details.
  const more = full.slice(full.indexOf(headline) + headline.length).replace(/[ \t]+/g, " ");
  return {
    id: m.id,
    headline,
    details: {
      about: more.trim() || undefined,
      notes: m.advice ? ["Demo advice: sample data, not financial advice"] : undefined,
    },
    yesLabel: main.label,
    // Its own snooze is Not now, unless it is the only button (then Yes, and Not now just
    // puts the card away here): never the same button twice.
    notNowLabel: snooze && snooze !== main ? snooze.label : "Not now",
    yesAction: main.id,
    notNowAction: snooze && snooze !== main ? snooze.id : null,
    choices: rest.filter((b) => b !== main).map((b) => ({ id: b.id, label: b.label })),
    noNever: true,
  };
}
