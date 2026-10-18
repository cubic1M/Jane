"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Kit } from "@/lib/diy";

// The do-it-yourself kit on a card the person chose to handle themselves.
export function DiyKit({
  kit,
  decisionId,
  doneOn,
}: {
  kit: Kit;
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
    <section className="flex flex-col gap-3 rounded-xl border border-emerald-200 p-4 dark:border-emerald-900">
      <h2 className="font-semibold">Doing it yourself</h2>
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
        <a
          href={kit.email.mailto}
          className="self-start font-medium text-emerald-700 hover:underline"
        >
          Write the email (opens your mail app)
        </a>
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
        </div>
      )}
      {doneOn ? (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950">
          You marked this done on {doneOn}. Nice work.
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
            I did it
          </button>
        </>
      )}
    </section>
  );
}
