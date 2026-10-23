"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FloatingCards, type CardAnswer } from "@/components/floating-cards";
import type { FloatingCardData } from "@/lib/floating-cards";
import type { MessageView } from "@/lib/jane-agent/view";
import { tapButton } from "./actions";
import { PracticeCards } from "./practice-cards";
import { SuggestionCards } from "./suggestion-cards";

// The one place cards float over the chat, one set at a time. Options of one choice that Jane
// just gave (a reply with refs.options: insurance cover, loan offers) come first, as the pick
// card; then the day's suggestions; then the practice portfolio's cards (step 296). A pick or
// Later takes the set away in the same frame, so the next card is on screen at once; the pick
// itself is sent behind it (option.pick with the option's id), and that lane's picker queues it
// for the team.

export function optionAction(how: CardAnswer): "option.pick" | "option.later" {
  return how === "yes" ? "option.pick" : "option.later";
}

export function ChatCards({
  options,
  suggestions,
  practice = [],
}: {
  // The newest open reply that carries options, if any.
  options: MessageView | null;
  suggestions: MessageView[];
  practice?: FloatingCardData[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // The option sets answered on this screen, before the server's reload drops them.
  const [answered, setAnswered] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const set = options?.options && !answered.includes(options.id) ? options.options : null;

  function onAnswer(message: MessageView, optionId: string, how: CardAnswer) {
    setAnswered((ids) => [...ids, message.id]);
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.set("messageId", message.id);
      data.set("actionId", optionAction(how));
      if (how === "yes") data.set("choice", optionId);
      const result = await tapButton({ message, error: null }, data);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      {error && (
        <p
          role="alert"
          className="fixed inset-x-4 top-4 z-50 mx-auto max-w-md border-2 border-red-700 bg-white p-3 text-sm text-red-800 shadow-lg dark:bg-zinc-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {set && options ? (
        <>
          <FloatingCards
            key={options.id}
            cards={set.options}
            mode="pick"
            label={set.title}
            onAnswer={(id, how) => onAnswer(options, id, how)}
          />
          <div aria-hidden="true" className="h-32" />
        </>
      ) : suggestions.length > 0 ? (
        <SuggestionCards messages={suggestions} />
      ) : (
        <PracticeCards cards={practice} />
      )}
    </>
  );
}
