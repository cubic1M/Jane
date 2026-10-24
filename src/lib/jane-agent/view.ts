import { toComparison, type Comparison } from "@/lib/comparison";
import { validTimezone } from "@/lib/digest/week";
import { landing } from "@/lib/area-pages/landing";
import type { OptionSet } from "@/lib/floating-cards";
import { toOptionSet } from "@/lib/option-set";
import { withFrom } from "./back-link";
import { drawBlock, parseBlock, type DrawnBlock } from "./blocks";

const drawn = (value: unknown): DrawnBlock | null => {
  const block = parseBlock(value);
  return block ? drawBlock(block) : null;
};
import type { ActionId, CardExtras, ChatMessage, MessageKind, MessageStatus } from "./types";

// A message as the chat shows it (spec step 81): plain data for the page. An open message
// shows its buttons; an answered one shows what was chosen instead, keeping only its
// links and an Undo while Undo still works.

export type MessageView = {
  id: string;
  kind: MessageKind;
  fromJane: boolean;
  // A short tag in front: what sort of message it is.
  tag: string;
  time: string;
  body: string;
  status: MessageStatus;
  answeredWith: string | null;
  note: string | null;
  // Demo advice (spec step 98): shown with DEMO_ADVICE_LABEL.
  advice: boolean;
  buttons: { id: ActionId; label: string; kind: "primary" | "secondary" | "quick" }[];
  links: { label: string; href: string }[];
  // Until when Undo works, so the page can hide it then.
  undoUntil: string | null;
  // Spec step 94: a block drawn in monospace, with its text alternative.
  block: DrawnBlock | null;
  // Spec step 96: pinned to the top of the chat.
  pinned: boolean;
  // One of the day's suggestions (it can sit in the card stack).
  suggestion: boolean;
  // Options of one choice (refs.options), while the message is open: the floating pick card.
  // Its buttons (option.pick, option.later) are the card's, not the message's.
  options: OptionSet | null;
  // The same options as comparison cards (src/lib/comparison.ts), which the chat shows instead
  // when the card carries their numbers (cards saved before them don't).
  comparison?: Comparison | null;
  // A suggestion card's extra details (refs.cardDetails), or null.
  cardDetails?: CardExtras | null;
  // A suggestion's whole reason (refs.suggestionWhy), or null.
  cardWhy?: string | null;
};

const TAGS: Record<MessageKind, string> = {
  brief: "brief",
  decision: "to decide",
  done: "done",
  heads_up: "heads-up",
  reply: "answer",
  user: "you",
};

// The messages the chat's list shows. A suggestion waiting in the floating cards is answered
// there, so the list leaves it out rather than show it twice; once answered it is in the list
// again, as history, with what was chosen.
export function inTheList(
  messages: readonly MessageView[],
  floating: readonly MessageView[],
): MessageView[] {
  const waiting = new Set(floating.map((m) => m.id));
  return messages.filter((m) => !(m.status === "open" && waiting.has(m.id)));
}

export function toView(message: ChatMessage, now: Date, timezone: string | null): MessageView {
  const undoUntil = message.refs.undoUntil ?? null;
  const undoOpen = undoUntil === null || new Date(undoUntil) > now;
  const buttons = message.actions.flatMap((a) => {
    if (a.kind === "link") return [];
    if (a.id.startsWith("option.")) return [];
    const isUndo = a.id.startsWith("undo.");
    if (message.status === "dismissed") return [];
    if (isUndo && !undoOpen) return [];
    if (message.status === "answered" && !isUndo) return [];
    return [{ id: a.id, label: a.label, kind: a.kind }];
  });
  return {
    id: message.id,
    kind: message.kind,
    fromJane: message.kind !== "user",
    tag: TAGS[message.kind],
    time: message.createdAt.toLocaleString("en-US", {
      timeZone: validTimezone(timezone),
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    body: message.body,
    status: message.status,
    answeredWith: message.answeredWith,
    note: message.refs.note ?? null,
    advice: message.refs.advice === true,
    buttons,
    // Spec step 86: a page opened from here links back to this message. An old link to an
    // area page lands on its node (src/lib/area-pages/landing.ts).
    links: message.actions.flatMap((a) =>
      a.kind === "link" ? [{ label: a.label, href: withFrom(landing(a.href), message.id) }] : [],
    ),
    undoUntil: buttons.some((b) => b.id.startsWith("undo.")) ? undoUntil : null,
    block: drawn(message.refs.block),
    pinned: message.refs.pinned === true,
    suggestion: Boolean(message.refs.suggestion),
    options:
      message.status === "open" && message.refs.options?.options?.length
        ? toOptionSet(message.refs.options)
        : null,
    comparison:
      message.status === "open" && message.refs.options?.options?.length
        ? toComparison(message.refs.options)
        : null,
    cardDetails: message.refs.cardDetails ?? null,
    cardWhy: message.refs.suggestionWhy ?? null,
  };
}
