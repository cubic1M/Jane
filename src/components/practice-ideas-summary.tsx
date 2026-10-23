import Link from "next/link";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { PracticeIdeasView } from "@/lib/practice/ideas-view";

// "Jane's practice ideas" on the investments page (Phase AW, Stage A): the ideas the constant
// search is waiting on, each with how sure Jane is, the strategy followed today and what the
// person's answers changed, in short. They're answered on the practice portfolio page or in the
// chat. Practice money and demo advice only.

const LINK = "font-medium text-emerald-700 hover:underline";
const SHOWN = 3;
const EFFECT = {
  sooner: "sooner",
  later: "later",
  safety: "still brought (a safety check)",
  same: "as before",
} as const;

export function PracticeIdeasSummary({ view }: { view: PracticeIdeasView }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="practice-ideas-summary-heading">
      <h2 id="practice-ideas-summary-heading" className="text-xl font-semibold">
        Jane&apos;s practice ideas
      </h2>
      {view.strategy && (
        <p className="text-sm">
          <span className="font-medium">Your practice portfolio&apos;s strategy today:</span>{" "}
          {view.strategy.label}. {view.strategy.followed ? "" : view.strategy.note}
        </p>
      )}
      {view.ideas.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing to decide right now. Jane looks every day and brings the next idea unasked.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {view.ideas.slice(0, SHOWN).map((i) => (
            <li key={i.suggestionKey} data-kind={i.kind}>
              {i.headline}{" "}
              <span className="text-xs text-zinc-500">({i.confidence.percent}% sure)</span>
            </li>
          ))}
        </ul>
      )}
      {view.learned.length > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Learned from your answers:{" "}
          {view.learned.map((l) => `${l.label.toLowerCase()} ${EFFECT[l.effect]}`).join(", ")}.
        </p>
      )}
      <Link href="/investments/practice" className={`text-sm ${LINK}`}>
        {view.ideas.length > 0
          ? `Answer ${view.ideas.length === 1 ? "it" : "them"} on your practice portfolio →`
          : "Your practice portfolio →"}
      </Link>
      <DemoAdviceLabel />
    </section>
  );
}
