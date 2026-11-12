"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FEEDBACK_MAX_UPLOAD_BYTES, REPORT_MAX_CHARS } from "@/lib/problem-reports";
import { sendProblemReport } from "./actions";

// The feedback itself: a few words, sent with the page it's about, and a screenshot if they want.
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
        // Said before the upload, not after a long wait for the server to refuse it.
        const shot = data.get("screenshot");
        if (shot instanceof File && shot.size > FEEDBACK_MAX_UPLOAD_BYTES) {
          return setError("That picture is too big. Try one under 4 MB.");
        }
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
        What&apos;s on your mind?
      </label>
      <textarea
        id="report-message"
        name="message"
        required
        rows={5}
        maxLength={REPORT_MAX_CHARS}
        className="rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
      />
      <label htmlFor="report-screenshot" className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Screenshot (optional)</span>
        <span className="text-zinc-600 dark:text-zinc-400">
          Only the founders see it. Cover anything you&apos;d rather not share.
        </span>
        <input
          id="report-screenshot"
          name="screenshot"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="text-sm"
        />
      </label>
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
