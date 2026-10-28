"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { REPORT_MAX_CHARS } from "@/lib/problem-reports";
import { sendProblemReport } from "./actions";

// The report itself: a few words, sent with the page it's about.
export function ReportForm({ from }: { from: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div role="status" data-report-sent="" className="flex flex-col gap-2">
        <p className="font-medium">Thanks. The founders will read it.</p>
        <Link href={from} className="self-start font-medium underline">
          Back to where you were
        </Link>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setError(null);
        start(async () => {
          const result = await sendProblemReport(data).catch(() => null);
          if (!result) return setError("That didn't send. Try again in a moment.");
          if (!result.ok) return setError(result.error);
          setSent(true);
        });
      }}
    >
      <input type="hidden" name="from" value={from} />
      <label htmlFor="report-message" className="font-medium">
        What went wrong?
      </label>
      <textarea
        id="report-message"
        name="message"
        required
        rows={5}
        maxLength={REPORT_MAX_CHARS}
        className="rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
      />
      {error && (
        <p role="alert" className="text-sm font-medium">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-900 px-6 text-sm font-semibold disabled:opacity-50 dark:border-zinc-100"
      >
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
