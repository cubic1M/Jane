"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import type { Kit } from "@/lib/diy";
import { dayLabel } from "@/lib/day-label";

// The do-it-yourself kit on a card the person chose to handle themselves (and, in read-only
// mode, every yes from a real account): the company's link, the steps, the email or script
// to copy, and Mark done so what it saves is counted.
export function DiyKit({
  kit,
  decisionId,
  doneOn,
  usually = null,
  switchLink = null,
}: {
  kit: Kit;
  // The option picked to switch to, with its sign-up link.
  switchLink?: { label: string; url: string } | null;
  // Median minutes our team spends on this at this merchant, once there are enough cases.
  usually?: number | null;
  decisionId: string;
  // When they marked it done (YYYY-MM-DD), if they have.
  doneOn: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");

  async function markDone() {
    setState("sending");
    const response = await fetch(`/api/decisions/${decisionId}/diy-done`, { method: "POST" }).catch(
      () => null,
    );
    if (!response?.ok) {
      setState("error");
      return;
    }
    router.refresh();
  }

  return (
    <section
      id="diy"
      className="flex scroll-mt-8 flex-col gap-3 rounded-xl border border-emerald-200 p-4 dark:border-emerald-900"
    >
      <h2 className="font-semibold">Doing it yourself</h2>
      {usually !== null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          With this company it usually takes about {usually} minutes.
        </p>
      )}
      {switchLink && (
        <a
          href={switchLink.url}
          target="_blank"
          rel="noreferrer"
          className="self-start font-medium underline underline-offset-2 hover:no-underline"
        >
          {switchLink.label} ↗
        </a>
      )}
      {kit.link && (
        <a
          href={kit.link.url}
          target="_blank"
          rel="noreferrer"
          className="self-start font-medium text-emerald-700 hover:underline"
        >
          {kit.link.label} ↗
        </a>
      )}
      <ol className="list-decimal space-y-1 pl-5">
        {kit.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {kit.email && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">The email</p>
          <p className="text-sm">Subject: {kit.email.subject}</p>
          <pre className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere] font-sans border border-zinc-300 p-3 dark:border-zinc-700">
            {kit.email.body}
          </pre>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={`${kit.email.subject}\n\n${kit.email.body}`} label="Copy the email" />
            <a
              href={kit.email.mailto}
              className="inline-flex min-h-11 items-center self-start font-medium text-emerald-700 hover:underline"
            >
              Write the email (opens your mail app)
            </a>
          </div>
        </div>
      )}
      {kit.script && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">What to say</p>
          <ul className="space-y-1">
            {kit.script.map((line) => (
              <li key={line} className="italic">
                &ldquo;{line}&rdquo;
              </li>
            ))}
          </ul>
          <CopyButton text={kit.script.join("\n")} label="Copy the script" />
        </div>
      )}
      {doneOn ? (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950">
          You marked this done on {dayLabel(doneOn, { year: true })}. Nice work.
        </p>
      ) : (
        <>
          {state === "error" && (
            <p role="alert" className="text-red-700">
              That didn&apos;t save. Try again.
            </p>
          )}
          <button
            type="button"
            onClick={markDone}
            disabled={state === "sending"}
            className="inline-flex h-12 items-center justify-center self-start rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Mark done
          </button>
        </>
      )}
    </section>
  );
}
