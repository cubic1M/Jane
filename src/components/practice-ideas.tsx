import { answerIdea } from "@/app/investments/practice/actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { PracticeIdeasView } from "@/lib/practice/ideas-view";
import { SubmitButton } from "@/components/submit-button";

// "Jane's ideas" on the practice portfolio page (Phase AW, Stage A): what the constant search
// found and is asking about, each with how sure Jane is and Yes or No; what the person's answers
// so far changed; and the strategy the autopilot follows today. Practice money and demo advice
// only.

const SMALL = "h-9 rounded-lg px-3 text-sm font-medium";

export function PracticeIdeasSection({ view }: { view: PracticeIdeasView }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="practice-ideas-heading">
      <div className="flex flex-col gap-1">
        <h2 id="practice-ideas-heading" className="text-xl font-semibold">
          Jane&apos;s ideas
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Jane looks for chances every day and when you open this page: dips to buy within the plan,
          losses to harvest, idle cash, cheaper funds, drift and more. What it&apos;d like you to
          decide waits here.
        </p>
      </div>
      {view.strategy && (
        <p className="text-sm" data-testid="practice-strategy">
          <span className="font-medium">Strategy today:</span> {view.strategy.label}{" "}
          <span className="text-xs text-zinc-500">{view.strategy.key}</span>.{" "}
          <span className="text-zinc-600 dark:text-zinc-400">{view.strategy.note}</span>
        </p>
      )}
      {view.ideas.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing to decide right now. Jane will bring the next idea here and in the chat.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.ideas.map((idea) => (
            <li
              key={idea.suggestionKey}
              data-kind={idea.kind}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <p className="font-medium">{idea.headline}</p>
              <p className="text-zinc-600 dark:text-zinc-400">{idea.short}</p>
              <p className="text-xs text-zinc-500">
                {idea.label}. {idea.confidence.percent}% sure: {idea.confidence.reason}.
              </p>
              {idea.figures.length > 0 && (
                <p className="text-xs text-zinc-500">
                  {idea.figures.map((f) => `${f.label} ${f.value}`).join(" · ")}
                </p>
              )}
              <form action={answerIdea} className="flex flex-wrap gap-2">
                <input type="hidden" name="key" value={idea.suggestionKey} />
                <SubmitButton
                  name="answer"
                  value="yes"
                  className={`${SMALL} bg-emerald-700 text-white hover:bg-emerald-800`}
                >
                  {idea.trades > 0 ? "Yes, do it in practice" : "Yes, open settings"}
                </SubmitButton>
                <SubmitButton
                  name="answer"
                  value="no"
                  className={`${SMALL} border border-zinc-300 dark:border-zinc-700`}
                >
                  No
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">What your answers changed</h3>
        {view.learned.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nothing yet. Each yes brings that kind of idea sooner; each no brings it later, and Jane
            never asks about that one again. Safety checks still come, just less often.
          </p>
        ) : (
          <ul className="text-sm">
            {view.learned.map((l) => (
              <li key={l.kind} data-effect={l.effect}>
                <span className="font-medium">{l.label}:</span> {l.says}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-zinc-500">Practice money only: nothing real is bought or sold.</p>
      <DemoAdviceLabel />
    </section>
  );
}
