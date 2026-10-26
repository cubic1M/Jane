"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const PRIMARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 sm:w-auto";
const SECONDARY_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full border border-zinc-300 px-6 font-semibold hover:bg-zinc-100 disabled:opacity-50 sm:w-auto dark:border-zinc-700 dark:hover:bg-zinc-900";

const CHOSEN_BUTTON =
  "inline-flex h-12 w-full items-center justify-center gap-1 rounded-full border-2 border-zinc-950 bg-zinc-950 px-6 font-semibold text-white sm:w-auto dark:border-white dark:bg-white dark:text-zinc-950";
const GREYED_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-full border border-zinc-300 px-6 font-semibold opacity-40 sm:w-auto dark:border-zinc-700";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string };

// What the server said about an answer: its decision (for Revert), or why not.
type Answer = { decisionId: string; diy?: boolean } | { error: string };

export function DecisionButtons({
  findingId,
  cardHash,
  undoSeconds,
  diy = false,
  switchTo,
  yesLabel = "Yes, do this for me",
  readOnly = false,
  showLabel = "Show me how",
}: {
  findingId: string;
  cardHash: string;
  undoSeconds: number;
  // Whether a do-it-yourself kit is offered.
  diy?: boolean;
  // The compared option picked to switch to, or "keep" (spec step 76).
  switchTo?: string;
  yesLabel?: string;
  // Read-only mode (a real account): nobody acts for them, so the yes is "Show me how", which
  // records it as theirs to do and opens the steps and drafts here.
  readOnly?: boolean;
  // The yes in read-only mode.
  showLabel?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  // The answer marked on screen at once (founder, 2026-10-25: "it should be instant ... just
  // grey them out, and there should be a revert button"), and the save on its way behind it.
  const [chosen, setChosen] = useState<"yes" | "no" | null>(null);
  const sending = useRef<Promise<Answer> | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // A No can be taken back for a few seconds: Revert counts them down, then goes.
  useEffect(() => {
    if (chosen !== "no" || secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [chosen, secondsLeft]);

  async function send(choice: "yes" | "no" | "diy"): Promise<Answer> {
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingId,
          choice,
          cardHash,
          ...(choice === "yes" && switchTo ? { switchTo } : {}),
        }),
      });
      const body = (await response.json()) as {
        decisionId?: string;
        error?: string;
        diy?: boolean;
      };
      if (!response.ok || !body.decisionId) {
        return { error: body.error ?? "Something went wrong. Try again." };
      }
      return { decisionId: body.decisionId, diy: body.diy };
    } catch {
      return { error: "We couldn't reach the server. Try again." };
    }
  }

  // Yes or No: marked at once, the other greyed, Revert offered; an error puts it back.
  function decide(choice: "yes" | "no") {
    // Read-only, the yes is "Show me how": recorded as theirs to do, and the steps open here.
    if (readOnly && choice === "yes") {
      setState({ kind: "sending" });
      void send("yes").then((answer) => {
        if ("error" in answer) setState({ kind: "error", message: answer.error });
        else {
          setState({ kind: "idle" });
          router.refresh();
        }
      });
      return;
    }
    setChosen(choice);
    setSecondsLeft(undoSeconds);
    setState({ kind: "idle" });
    const sent = send(choice);
    sending.current = sent;
    void sent.then((answer) => {
      if (sending.current !== sent) return;
      if ("error" in answer) {
        setChosen(null);
        setState({ kind: "error", message: answer.error });
      } else if (answer.diy) {
        // The card page shows the kit once the answer is saved.
        router.refresh();
      }
    });
  }

  function revert() {
    const was = chosen;
    const sent = sending.current;
    if (!was || !sent) return;
    setChosen(null);
    sending.current = null;
    setState({ kind: "idle" });
    void sent
      .then(async (answer) => {
        if ("error" in answer) return null;
        const response = await fetch(`/api/decisions/${answer.decisionId}/revert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ choice: was }),
        });
        if (response.ok) return null;
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return body.error ?? "It was too late to take that back.";
      })
      .catch(() => "We couldn't reach the server. Try again.")
      .then((message) => {
        if (!message) {
          router.refresh();
          return;
        }
        setChosen(was);
        sending.current = sent;
        setState({ kind: "error", message });
      });
  }

  async function diyNow() {
    setState({ kind: "sending" });
    const answer = await send("diy");
    if ("error" in answer) setState({ kind: "error", message: answer.error });
    else {
      setState({ kind: "idle" });
      router.refresh();
    }
  }

  const yesText = readOnly ? showLabel : yesLabel;
  const button = (choice: "yes" | "no", label: string, style: string) =>
    chosen ? (
      <button
        type="button"
        disabled
        aria-pressed={chosen === choice}
        className={chosen === choice ? CHOSEN_BUTTON : GREYED_BUTTON}
      >
        {label}
        {chosen === choice && <span aria-hidden="true"> [✓ chosen]</span>}
        {chosen === choice && <span className="sr-only">, chosen</span>}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => decide(choice)}
        disabled={state.kind === "sending"}
        className={style}
      >
        {label}
      </button>
    );
  const canRevert = chosen === "yes" || (chosen === "no" && secondsLeft > 0);

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
      <div className="flex flex-col gap-3 sm:flex-row" data-decision-buttons="">
        {button("yes", yesText, PRIMARY_BUTTON)}
        {button("no", "No thanks", SECONDARY_BUTTON)}
        {chosen && canRevert && (
          <button type="button" onClick={revert} className={SECONDARY_BUTTON}>
            <span aria-hidden="true">↶ </span>Revert
            {chosen === "no" ? ` (${secondsLeft}s)` : ""}
          </button>
        )}
      </div>
      {chosen && (
        <p role="status">
          {chosen === "yes" ? (
            <>
              Approved. Jane is on it.{" "}
              <Link
                href="/actions"
                // After the yes is saved, so the action is there when the page opens.
                onClick={(e) => {
                  const sent = sending.current;
                  if (!sent) return;
                  e.preventDefault();
                  void sent.then(() => router.push("/actions"));
                }}
                className="font-medium underline"
              >
                Follow it on your actions ›
              </Link>
            </>
          ) : (
            <>
              Got it, we&apos;ll leave this alone.{" "}
              <Link href="/report" className="font-medium underline">
                Back to your report ›
              </Link>
            </>
          )}
        </p>
      )}
      {diy && !readOnly && !chosen && (
        <button
          type="button"
          onClick={diyNow}
          disabled={state.kind === "sending"}
          className="self-start text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50"
        >
          I&apos;ll do it myself: show me how
        </button>
      )}
      {!chosen && (
        <Link href="/report" className="text-sm text-zinc-500 hover:underline">
          Decide later
        </Link>
      )}
    </div>
  );
}
