"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PickResult } from "@/lib/compare-actions";
import { ComparisonCards } from "@/components/comparison-cards";
import { FloatingCards, type CardAnswer } from "@/components/floating-cards";
import type { Comparison } from "@/lib/comparison";
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
// for the team. A card that carries the comparison's numbers shows as comparison cards in a
// sheet over the chat instead (src/components/comparison-cards.tsx): sort by what matters,
// choose one, and the sheet stays with the choice shown until it's closed.

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
  // The sheet a pick was made on, kept on screen (with the choice) after the reload drops it.
  const [kept, setKept] = useState<{ message: MessageView; comparison: Comparison } | null>(null);
  const set = options?.options && !answered.includes(options.id) ? options.options : null;
  const sheet =
    kept ??
    (options?.comparison && !answered.includes(options.id)
      ? { message: options, comparison: options.comparison }
      : null);

  async function pickOn(message: MessageView, comparison: Comparison, optionId: string) {
    setKept({ message, comparison });
    setError(null);
    const data = new FormData();
    data.set("messageId", message.id);
    data.set("actionId", "option.pick");
    data.set("choice", optionId);
    const result = await tapButton({ message, error: null }, data);
    router.refresh();
    return result.error
      ? ({ ok: false, error: result.error } satisfies PickResult)
      : ({ ok: true, note: result.message.note ?? "" } satisfies PickResult);
  }

  function closeSheet(message: MessageView) {
    setAnswered((ids) => [...ids, message.id]);
    setKept(null);
  }

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
      {sheet ? (
        <>
          <div
            role="dialog"
            aria-label={sheet.comparison.title}
            className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-y-auto border-t-2 border-zinc-950 bg-white p-4 shadow-2xl dark:border-white dark:bg-zinc-950"
          >
            <div className="relative mx-auto max-w-5xl">
              {kept && (
                <button
                  type="button"
                  onClick={() => closeSheet(sheet.message)}
                  aria-label="Close"
                  className="absolute top-0 right-0 inline-flex size-11 items-center justify-center font-mono"
                >
                  ×
                </button>
              )}
              <ComparisonCards
                key={sheet.message.id}
                comparison={sheet.comparison}
                onPick={(id) => pickOn(sheet.message, sheet.comparison, id)}
                onLater={() => onAnswer(sheet.message, "", "not_now")}
              />
            </div>
          </div>
          <div aria-hidden="true" className="h-[60vh]" />
        </>
      ) : set && options ? (
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
