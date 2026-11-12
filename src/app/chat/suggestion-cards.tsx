"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { FloatingCards, type CardAnswer } from "@/components/floating-cards";
import type { FloatingCardData } from "@/lib/floating-cards";
import type { MessageView } from "@/lib/jane-agent/view";
import { DONE_ACTION, REVERT_ACTION } from "@/lib/jane-agent/choices";
import { popupCard, type PopupCard } from "@/lib/jane-agent/popups";
import {
  goneServerSnapshot,
  goneSnapshot,
  markGone,
  subscribeGone,
  withoutGone,
} from "@/lib/dock-gone";
import { AI_WRITTEN_LABEL, DEMO_ADVICE_LABEL } from "@/config/advice";
import { STEP_LINK_LABELS } from "@/config/suggestion-step";
import { noteDetailsOpened, tapButton, type MessageState } from "./actions";

// Jane's pop-ups over the chat or the page (src/lib/jane-agent/popups.ts): the day's suggestions,
// then anything else it brought up that waits on the person, one card at a time. A suggestion
// message is three lines (src/lib/jane-agent/sources/suggestions.ts): the
// headline, "Why you: …" and "85% sure: reason." The card shows the headline with Yes and Not
// now; the rest is behind More details, already on the page. A tap is answered on screen at
// once and sent to the server in the background, through the same action as the chat's buttons.

export function cardParts(body: string): {
  headline: string;
  why: string | null;
  percent: number | null;
  reason: string | null;
} {
  const lines = body.split("\n");
  const sure = /^(\d{1,3})% sure: (.*?)\.?$/.exec(lines[2] ?? "");
  if (lines.length === 3 && lines[1].startsWith("Why you: ") && sure) {
    return {
      headline: lines[0],
      why: lines[1].slice("Why you: ".length),
      percent: Number(sure[1]),
      reason: sure[2],
    };
  }
  return { headline: lines[0], why: lines.slice(1).join(" ") || null, percent: null, reason: null };
}

const ACTION_FOR: Record<CardAnswer, string> = {
  yes: "suggestion.yes",
  not_now: "snooze",
  never: "suggestion.no",
};

// The step a Yes came back with (the "Open it" link), or null: a card answered elsewhere, an
// error, or an answer with nowhere to go (debugger round 208: Yes recorded the answer and the dock
// moved on, the step shown nowhere).
export function stepAfterYes(result: MessageState | null | undefined): string | null {
  if (!result || result.error) return null;
  return result.message.links.find((l) => STEP_LINK_LABELS.includes(l.label))?.href ?? null;
}

// Opens a page from wherever the cards are: the page itself (the dock, Home), or the chat's frame
// on a phone, whose bridge opens it in the page and closes the sheet (src/app/chat/embed-bridge.tsx).
// False for the chat opened on its own (only tests do): it stays the chat.
function openStep(href: string, push: (href: string) => void): boolean {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: "jane:navigate", href }, window.location.origin);
    return true;
  }
  if (document.querySelector("[data-chat-embed]")) return false;
  push(href);
  return true;
}

export function cardOf(message: MessageView): FloatingCardData {
  const parts = cardParts(message.body);
  const yes = message.buttons.find((b) => b.id === "suggestion.yes");
  // A practice idea (Phase AW) also has its numbers and caps, and its own Yes.
  const extra = message.cardDetails;
  const notes = [
    // The learning loop: what other people did with this kind of suggestion.
    ...(message.cardPeople ? [message.cardPeople] : []),
    ...(extra?.caps ?? []).map((c) => `Cap: ${c}`),
  ];
  // On the card's face: demo advice, and that Claude wrote it (a strategist idea; Anthropic's
  // usage policy asks that it say so).
  const badges = [
    ...(message.advice ? [DEMO_ADVICE_LABEL] : []),
    ...(message.aiWritten ? [AI_WRITTEN_LABEL] : []),
  ];
  return {
    id: message.id,
    headline: parts.headline,
    ...(badges.length > 0 ? { badge: badges.join(" · ") } : {}),
    details: {
      // The whole reason, so the headline's figure is explained; the short line otherwise.
      why: message.cardWhy ?? parts.why ?? undefined,
      figures: extra && extra.figures.length > 0 ? extra.figures : undefined,
      confidence:
        parts.percent !== null && parts.reason
          ? { percent: parts.percent, reason: parts.reason }
          : undefined,
      whatYesDoes: extra
        ? `${yes ? `${yes.label}. ` : ""}${extra.whatYesDoes}`
        : yes
          ? `${yes.label}. Nothing is bought or moved: Yes puts it on your list; Open takes you to the page.`
          : undefined,
      notes: notes.length > 0 ? notes : undefined,
    },
    yesLabel: "Yes",
    notNowLabel: "Not now",
  };
}

// Following a card to the page it points at is engaging with it (founder: the card came straight
// back on that page): a suggestion takes its own Yes (answered yes; what it saves stays an
// estimate until the transactions show it), anything else its own Not now (put off until
// tomorrow). A card with neither is only left out for the rest of the tab's session.
export function followAction(message: Pick<MessageView, "suggestion" | "buttons">): string | null {
  if (message.suggestion && message.buttons.some((b) => b.id === "suggestion.yes")) {
    return "suggestion.yes";
  }
  return message.buttons.some((b) => b.id === "snooze") ? "snooze" : null;
}

export function SuggestionCards({
  messages: given,
  foldOnPhone = false,
  foldOnSend = false,
  docked = false,
  onAnswered,
  onShowing,
}: {
  messages: MessageView[];
  // Home: start folded on a small phone, so the net worth shows first.
  foldOnPhone?: boolean;
  // The chat: fold on a small phone once the person sends a message, so the answer shows.
  foldOnSend?: boolean;
  // In the dock above the side chat, not floating over the page.
  docked?: boolean;
  // Told once the server has the answer (the dock reloads its cards).
  onAnswered?: () => void;
  // Told which card is showing.
  onShowing?: (id: string | null) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Never one the person dealt with in this tab, even if a load brought it back before its
  // answer reached the server (src/lib/dock-gone.ts).
  const gone = useSyncExternalStore(subscribeGone, goneSnapshot, goneServerSnapshot);
  const messages = useMemo(() => withoutGone(given, gone.split(",")), [given, gone]);
  const [open, setOpen] = useState(messages.length);
  // Each card's last tap still on its way to the server, so a Revert follows its choice.
  const sending = useRef(new Map<string, Promise<unknown>>());
  const cards = useMemo(
    () =>
      messages.map((m): FloatingCardData | PopupCard => (m.suggestion ? cardOf(m) : popupCard(m))),
    [messages],
  );
  const links = useMemo(
    () =>
      Object.fromEntries(
        messages.map((m) => [m.id, m.links.map((l) => ({ label: l.label, href: l.href }))]),
      ),
    [messages],
  );

  if (messages.length === 0) return null;
  return (
    <>
      <FloatingCards
        cards={cards}
        label="Suggestions for you"
        neverLabel="Don't suggest this again"
        links={links}
        foldOnPhone={foldOnPhone}
        foldOnSend={foldOnSend}
        docked={docked}
        onShowing={onShowing}
        onDetails={(id) => {
          // A suggestion looked at: kept for its outcome, after the screen has opened it.
          if (messages.find((m) => m.id === id)?.suggestion) {
            startTransition(async () => {
              await noteDetailsOpened(id).catch(() => {});
            });
          }
        }}
        onFollow={(id, href) => {
          setOpen((n) => Math.max(0, n - 1));
          const message = messages.find((m) => m.id === id);
          markGone(id);
          // On the page itself, a client navigation: instant, and the dock stays. In the chat's
          // frame the link goes to the bridge, which opens it in the page (embed-bridge.tsx).
          const here = window.self === window.top && href.startsWith("/");
          if (here) router.push(href);
          const actionId = message ? followAction(message) : null;
          if (!message || !actionId) return here;
          // Behind the navigation: the next page's dock already leaves it out.
          void queue(message, actionId)
            .catch(() => undefined)
            .then(() => onAnswered?.());
          return here;
        }}
        onAnswer={(id, how, choice) => {
          setOpen((n) => Math.max(0, n - 1));
          const message = messages.find((m) => m.id === id)!;
          const card = cards.find((c) => c.id === id) as PopupCard;
          // Gone from every stack in this tab at once, unless it stays on screen chosen (with
          // Revert and Done) until it settles.
          if (!(how === "yes" && card.revertable)) markGone(id);
          // A suggestion answers Yes, Not now or Never; anything else taps its own buttons,
          // and Not now without a button of its own only puts it off on this screen.
          const actionId = message.suggestion
            ? ACTION_FOR[how]
            : how === "yes"
              ? (choice ?? card.yesAction)
              : card.notNowAction;
          if (!actionId) return;
          // The server work follows the screen: the card is already gone (or, for a choice,
          // already marked).
          send(id, actionId);
        }}
        onRevert={(id) => send(id, REVERT_ACTION)}
        onSettle={(id) => {
          markGone(id);
          send(id, DONE_ACTION);
        }}
      />
      {/* Room at the end of the page so the message box is never under a card. */}
      {open > 0 && !docked && <div aria-hidden="true" data-card-room="" className="h-28" />}
    </>
  );

  // In order behind the card's last tap (a choice right after a Revert).
  function queue(message: MessageView, actionId: string) {
    const data = new FormData();
    data.set("messageId", message.id);
    data.set("actionId", actionId);
    const sent = (sending.current.get(message.id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => tapButton({ message, error: null }, data));
    sending.current.set(message.id, sent);
    return sent;
  }

  // An answer, or Revert or Done on a chosen card: then the page and the dock catch up.
  function send(id: string, actionId: string) {
    const message = messages.find((m) => m.id === id);
    if (!message) return;
    const sent = queue(message, actionId);
    startTransition(async () => {
      const result = await sent.catch(() => null);
      // Yes ends on the step Jane prepared, not on the next card (find → prefill → yes).
      const step = actionId === ACTION_FOR.yes ? stepAfterYes(result) : null;
      if (!step || !openStep(step, router.push)) router.refresh();
      onAnswered?.();
    });
  }
}
