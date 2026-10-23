"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { FloatingCards, type CardAnswer } from "@/components/floating-cards";
import type { FloatingCardData } from "@/lib/floating-cards";
import type { MessageView } from "@/lib/jane-agent/view";
import { tapButton } from "./actions";

// The day's suggestions as floating cards over the chat (founder request), one at a time.
// A suggestion message is three lines (src/lib/jane-agent/sources/suggestions.ts): the
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
    ...(extra?.caps ?? []).map((c) => `Cap: ${c}`),
    ...(message.advice ? ["Demo advice: sample data, not financial advice"] : []),
  ];
  return {
    id: message.id,
    headline: parts.headline,
    details: {
      why: parts.why ?? undefined,
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

export function SuggestionCards({ messages }: { messages: MessageView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(messages.length);
  const cards = useMemo(() => messages.map(cardOf), [messages]);
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
        onAnswer={(id, how) => {
          setOpen((n) => Math.max(0, n - 1));
          // The server work follows the screen: the card is already gone.
          startTransition(async () => {
            const data = new FormData();
            data.set("messageId", id);
            data.set("actionId", ACTION_FOR[how]);
            const message = messages.find((m) => m.id === id)!;
            await tapButton({ message, error: null }, data);
            router.refresh();
          });
        }}
      />
      {/* Room at the end of the chat so the message box is never under a card. */}
      {open > 0 && <div aria-hidden="true" className="h-64 sm:h-56" />}
    </>
  );
}
