import { ATTENTION_STOP_AFTER } from "@/config/attention";
import { hourWords, type Attention } from "@/lib/jane-agent/attention";
import { bringBack } from "./attention-actions";
import { SubmitButton } from "@/components/submit-button";

// Asking less (spec step 147): what Jane learned about when and how the person answers, and
// each kind of message it stopped bringing up, with why and Bring them back.
export function AttentionList({ attention }: { attention: Attention }) {
  const muted = "text-zinc-600 dark:text-zinc-400";
  return (
    <div className="flex flex-col gap-3">
      <p className={muted}>
        {attention.usualHour === null
          ? "Once you've answered me a few times, I'll save what isn't urgent for the time of day you usually answer."
          : `You usually answer me ${hourWords(attention.usualHour)}, so I save what isn't urgent for then (never more than a day).`}{" "}
        {attention.channel === "push"
          ? "Phone notifications get your answers more than email, so that's where I send them first."
          : attention.channel === "email"
            ? "Email gets your answers more than phone notifications, so that's where I send them first."
            : ""}{" "}
        Urgent alerts, deadlines and bills always come straight away.
      </p>
      {attention.stopped.length === 0 ? (
        <p className={muted}>I haven&apos;t stopped bringing anything up.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {attention.stopped.map((kind) => (
            <li key={kind.source} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium">Stopped: {kind.label}.</span>{" "}
                <span className={`text-sm ${muted}`}>
                  You hadn&apos;t said yes to the last {ATTENTION_STOP_AFTER}.
                </span>
              </span>
              <form action={bringBack}>
                <input type="hidden" name="source" value={kind.source} />
                <SubmitButton className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-medium text-emerald-700 hover:underline">
                  Bring them back<span className="sr-only">: {kind.label}</span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
