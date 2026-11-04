import { sendTryFeedback } from "@/app/try/feedback-actions";
import { REPORT_MAX_CHARS } from "@/lib/problem-reports";

const PROBLEMS: Record<string, string> = {
  busy: "That's a lot of messages. Try again in an hour.",
  empty: "Say what Jane got wrong, in a few words.",
};

// During a try, on the report and on Home: a try is deleted, so what's said here isn't tied to the person (founder
// 11-04). No client code: Home is close to its JavaScript budget.
export function TryFeedbackBox({ from, state }: { from: "/home" | "/report"; state?: string }) {
  if (state === "sent") {
    return (
      <p role="status" data-try-feedback-sent="" className="text-sm font-medium">
        Thanks. The founders will read it.
      </p>
    );
  }
  const problem = state ? PROBLEMS[state] : undefined;
  return (
    <form
      action={sendTryFeedback}
      data-try-feedback=""
      className="flex flex-col gap-2 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950"
    >
      <input type="hidden" name="from" value={from} />
      <label htmlFor="try-feedback" className="text-sm font-semibold">
        What did Jane get wrong?
      </label>
      <textarea
        id="try-feedback"
        name="message"
        required
        rows={2}
        maxLength={REPORT_MAX_CHARS}
        className="border border-zinc-300 bg-transparent p-2 text-base dark:border-zinc-700"
      />
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        It isn&apos;t linked to you and stays after your try is deleted, so leave out names and
        account numbers.
      </p>
      {problem && (
        <p role="alert" className="text-sm font-medium">
          {problem}
        </p>
      )}
      <button
        type="submit"
        className="inline-flex min-h-11 items-center self-start text-sm font-semibold hover:underline"
      >
        [SEND]
      </button>
    </form>
  );
}
