"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const PRIMARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 sm:w-auto";
const SECONDARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full border border-zinc-300 px-6 font-semibold hover:bg-zinc-100 disabled:opacity-50 sm:w-auto dark:border-zinc-700 dark:hover:bg-zinc-900";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "declined"; decisionId: string; secondsLeft: number }
  | { kind: "error"; message: string };

export function DecisionButtons({
  findingId,
  cardHash,
  undoSeconds,
}: {
  findingId: string;
  cardHash: string;
  undoSeconds: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  // Counts down the undo window after a no, then goes back to the report.
  useEffect(() => {
    if (state.kind !== "declined") return;
    if (state.secondsLeft <= 0) {
      router.push("/report");
      return;
    }
    const timer = setTimeout(
      () => setState({ ...state, secondsLeft: state.secondsLeft - 1 }),
      1000,
    );
    return () => clearTimeout(timer);
  }, [state, router]);

  async function decide(choice: "yes" | "no") {
    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId, choice, cardHash }),
      });
      const body = (await response.json()) as { decisionId?: string; error?: string };
      if (!response.ok || !body.decisionId) {
        setState({ kind: "error", message: body.error ?? "Something went wrong. Try again." });
        return;
      }
      if (choice === "yes") {
        router.push("/actions");
      } else {
        setState({ kind: "declined", decisionId: body.decisionId, secondsLeft: undoSeconds });
      }
    } catch {
      setState({ kind: "error", message: "We couldn't reach the server. Try again." });
    }
  }

  async function undo(decisionId: string) {
    setState({ kind: "sending" });
    const response = await fetch(`/api/decisions/${decisionId}/undo`, { method: "POST" }).catch(
      () => null,
    );
    if (!response?.ok) {
      setState({ kind: "error", message: "It was too late to undo that." });
      return;
    }
    setState({ kind: "idle" });
    router.refresh();
  }

  if (state.kind === "declined") {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-xl bg-zinc-100 p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-zinc-900"
      >
        <p>Got it, we&apos;ll leave this alone.</p>
        <button type="button" onClick={() => undo(state.decisionId)} className={SECONDARY_BUTTON}>
          Undo ({state.secondsLeft}s)
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.kind === "error" && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {state.message}{" "}
          <button type="button" onClick={() => router.refresh()} className="underline">
            Reload
          </button>
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => decide("yes")}
          disabled={state.kind === "sending"}
          className={PRIMARY_BUTTON}
        >
          Yes, do this for me
        </button>
        <button
          type="button"
          onClick={() => decide("no")}
          disabled={state.kind === "sending"}
          className={SECONDARY_BUTTON}
        >
          No thanks
        </button>
      </div>
      <Link href="/report" className="text-sm text-zinc-500 hover:underline">
        Decide later
      </Link>
    </div>
  );
}
