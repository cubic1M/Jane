"use client";

import { useState } from "react";

// Copies a draft (an email, a call script, a letter) for the person to paste where they send
// it themselves (read-only mode). Says "Copied" for a moment; if the browser won't allow it,
// the text is still on the page to select.
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-11 items-center self-start rounded-full border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Select the text to copy" : label}
      </span>
    </button>
  );
}
