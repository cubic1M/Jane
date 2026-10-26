"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { FloatingCards, type CardAnswer } from "@/components/floating-cards";
import type { FloatingCardData } from "@/lib/floating-cards";
import type { MessageView } from "@/lib/jane-agent/view";
import { DONE_ACTION, REVERT_ACTION } from "@/lib/jane-agent/choices";
import { popupCard, type PopupCard } from "@/lib/jane-agent/popups";
import { noteDetailsOpened, tapButton } from "./actions";

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

export function cardOf(message: MessageView): FloatingCardData {
  const parts = cardParts(message.body);
  const yes = message.buttons.find((b) => b.id === "suggestion.yes");
  // A practice idea (Phase AW) also has its numbers and caps, and its own Yes.
  const extra = message.cardDetails;
  const notes = [
    // The learning loop: what other people did with this kind of suggestion.
    ...(message.cardPeople ? [message.cardPeople] : []),
    ...(extra?.caps ?? []).map((c) => `Cap: ${c}`),
    ...(message.advice ? ["Demo advice: sample data, not financial advice"] : []),
  ];
  return {
    id: message.id,
    headline: parts.headline,
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
          ? `${yes.label}. Nothing is bought or moved: Yes takes you to the page where you finish it.`
          : undefined,
      notes: notes.length > 0 ? notes : undefined,
    },
    yesLabel: "Yes",
    notNowLabel: "Not now",
  };
}

export function SuggestionCards({
  messages,
  foldOnPhone = false,
  docked = false,
  onAnswered,
  onShowing,
}: {
  messages: MessageView[];
  // Home: start folded on a small phone, so the net worth shows first.
  foldOnPhone?: boolean;
  // In the dock above the side chat, not floating over the page.
  docked?: boolean;
  // Told once the server has the answer (the dock reloads its cards).
  onAnswered?: () => void;
  // Told which card is showing.
  onShowing?: (id: string | null) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
        onAnswer={(id, how, choice) => {
          setOpen((n) => Math.max(0, n - 1));
          const message = messages.find((m) => m.id === id)!;
          const card = cards.find((c) => c.id === id) as PopupCard;
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
          const data = new FormData();
          data.set("messageId", id);
          data.set("actionId", actionId);
          // In order behind the card's last tap (a choice right after a Revert).
          const sent = (sending.current.get(id) ?? Promise.resolve())
            .catch(() => undefined)
            .then(() => tapButton({ message, error: null }, data));
          sending.current.set(id, sent);
          startTransition(async () => {
            await sent;
            router.refresh();
            onAnswered?.();
          });
        }}
        onRevert={(id) => send(id, REVERT_ACTION)}
        onSettle={(id) => send(id, DONE_ACTION)}
      />
      {/* Room at the end of the page so the message box is never under a card. */}
      {open > 0 && !docked && <div aria-hidden="true" data-card-room="" className="h-28" />}
    </>
  );

  // Revert or Done on a chosen card: after the card's last tap has reached the server.
  function send(id: string, actionId: string) {
    const message = messages.find((m) => m.id === id);
    if (!message) return;
    const data = new FormData();
    data.set("messageId", id);
    data.set("actionId", actionId);
    const sent = (sending.current.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => tapButton({ message, error: null }, data));
    sending.current.set(id, sent);
    startTransition(async () => {
      await sent;
      router.refresh();
      onAnswered?.();
    });
  }
}
