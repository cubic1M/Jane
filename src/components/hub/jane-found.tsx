import Link from "next/link";
import type { ReactNode } from "react";

// Home's one job besides where you stand (founder 11-12: "Jane is supposed to watch your finances
// 24/7, proactively search for opportunities where you can save money, and then find you the
// solution and prefill the step"): what Jane found, each a yes or not now. The cards are the
// decisions (in the page on a phone or tablet, in the dock beside the chat on a computer); this
// says how many there are and where the whole list is.

// One line under "Jane found", never "$0/yr": still looking before the first scan has looked
// (beta walk 11-12: "Nothing yet" beside tiles full of things), else how many, else nothing yet.
export function foundLine(items: number, looking: boolean): string {
  // No count: the plan's whole list and today's cards ("1 of 13") are different numbers.
  if (items > 0) return "Yes or not now, one at a time.";
  return looking ? "Still looking through your accounts." : "Nothing yet. Jane keeps watching.";
}

export function JaneFound({
  items,
  looking,
  children,
}: {
  // Open findings on the plan.
  items: number;
  // The first scan hasn't looked yet.
  looking: boolean;
  // The yes/no cards.
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="jane-found" data-jane-found="" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="jane-found" className="text-base font-semibold">
          Jane found
        </h2>
        {items > 0 && (
          <Link
            href="/plan"
            className="font-mono text-sm font-medium underline-offset-2 hover:underline"
          >
            Full list ›
          </Link>
        )}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{foundLine(items, looking)}</p>
      {children}
    </section>
  );
}
