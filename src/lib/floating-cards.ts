// The rules of the floating cards (src/components/floating-cards.tsx), apart from the screen,
// so they can be tested: which card is showing, what a tap does to the set, the counter.
//
// Two modes share one component. "queue": a line of separate cards (the day's suggestions);
// Yes or Not now on one takes just that one away and the next slides in. "pick": options of
// ONE choice (insurance plans, loan offers); Yes on one picks it and the whole set is done,
// and Not now puts the whole set off.

export type CardMode = "queue" | "pick";

// What a card shows once More details is open. Pre-rendered with the card: opening it is a
// toggle, never a fetch.
export type CardDetails = {
  // Why this person, in a sentence with their own number.
  why?: string;
  // The whole message, when the headline is a cut of it (a decision, a heads-up): no label.
  about?: string;
  // The figures used, each labelled.
  figures?: { label: string; value: string }[];
  // How sure Jane is, and the reason.
  confidence?: { percent: number; reason: string };
  // What a Yes does, in a sentence.
  whatYesDoes?: string;
  // Anything else worth a line (the demo-advice label).
  notes?: string[];
};

// The shape every lane feeds the cards (docs/spec.md, "Floating cards"): a headline of about
// eight words with one number, an optional one-line summary (for options: why it is better or
// worse than the others), the details, and the labels.
export type FloatingCardData = {
  id: string;
  headline: string;
  summary?: string;
  details: CardDetails;
  // A small label by the counter ("Jane's pick", only in demo advice mode).
  badge?: string;
  yesLabel: string;
  notNowLabel?: string;
  // Other answers than Yes (something Jane asked to decide between), behind More details.
  choices?: { id: string; label: string }[];
  // Not one of the day's suggestions: no "Don't suggest this again".
  noNever?: boolean;
};

export type CardsState = {
  // Cards no longer waiting (answered or put off).
  gone: readonly string[];
  // Which waiting card is showing (an index into the waiting ones).
  index: number;
};

export const initialState: CardsState = { gone: [], index: 0 };

export const waiting = (cards: readonly FloatingCardData[], state: CardsState) =>
  cards.filter((c) => !state.gone.includes(c.id));

export function currentCard(
  cards: readonly FloatingCardData[],
  state: CardsState,
): FloatingCardData | null {
  const left = waiting(cards, state);
  if (left.length === 0) return null;
  return left[Math.max(0, Math.min(state.index, left.length - 1))];
}

// Yes on a card: in "queue" just that card goes; in "pick" the whole set is decided.
// Not now: the same, one card or the whole set.
export function answer(
  cards: readonly FloatingCardData[],
  state: CardsState,
  mode: CardMode,
  id: string,
): CardsState {
  const gone = mode === "pick" ? cards.map((c) => c.id) : [...new Set([...state.gone, id])];
  // The next card slides into the place of the one that left.
  return { gone, index: state.index };
}

export function move(
  cards: readonly FloatingCardData[],
  state: CardsState,
  by: 1 | -1,
): CardsState {
  const last = Math.max(0, waiting(cards, state).length - 1);
  return { ...state, index: Math.max(0, Math.min(last, state.index + by)) };
}

// The small counter: "3 left" for a line of cards, "2 of 3" for options to pick from.
export function counter(
  cards: readonly FloatingCardData[],
  state: CardsState,
  mode: CardMode,
): string {
  const left = waiting(cards, state).length;
  if (mode === "queue") return `${left} left`;
  return `${Math.min(state.index, Math.max(0, left - 1)) + 1} of ${left}`;
}

// Options of ONE choice (insurance plans to switch to, loan offers): each option is a card with
// a one-line summary of why it is better or worse than the others, and the user picks one. The
// lanes build these and hand them to <FloatingCards mode="pick">; Yes on an option picks it.
export type OptionCardData = FloatingCardData & {
  // Why this one is better or worse than the others, in one line ("$408 less a year, same
  // cover" / "Cheapest, but a $1,000 deductible").
  summary: string;
};

export type OptionSet = {
  // The choice being made ("Car insurance quotes"); the overlay's accessible name.
  title: string;
  options: OptionCardData[];
};
