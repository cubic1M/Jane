"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FloatingCards } from "@/components/floating-cards";
import { PAUSE_HREF } from "@/config/practice-cards";
import type { FloatingCardData } from "@/lib/floating-cards";
import { putAwayPracticeCard } from "./practice-actions";

// The practice portfolio's cards over the chat (spec step 296): what the daily scan flagged and
// what the autopilot did, one at a time. The button only opens the pause switch; Got it puts
// the card away. Nothing is ever bought from a card. The card leaves at once; the server work
// follows in the background.

export function PracticeCards({ cards }: { cards: FloatingCardData[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  if (cards.length === 0) return null;
  return (
    <FloatingCards
      cards={cards}
      label="Your practice portfolio"
      onAnswer={(id, how) => {
        if (how === "yes") router.push(PAUSE_HREF);
        startTransition(async () => {
          await putAwayPracticeCard(id);
          if (how !== "yes") router.refresh();
        });
      }}
    />
  );
}
