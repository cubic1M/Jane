"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { PEOPLE } from "@/config/people";
import { tryJane, type TryState } from "@/app/try/actions";

// "Try it with sample data" on the landing page (spec step 138): a sample person with fake
// data, deleted after a day. Agreeing to the Terms first, as at sign-up.
export function TryButton() {
  const [state, action, pending] = useActionState<TryState, FormData>(tryJane, null);
  const router = useRouter();
  const next = state && "next" in state ? state.next : null;
  // The sample person is made and signed in: on to the chat. The button stays disabled until
  // the page changes, so a second tap can't make a second person.
  useEffect(() => {
    if (!next) return;
    router.replace(next);
    // If the soft navigation has not landed in a few seconds, a plain page load will.
    const fallback = setTimeout(() => window.location.assign(next), 4000);
    return () => clearTimeout(fallback);
  }, [next, router]);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <input type="checkbox" name="consent" required className="mt-0.5 h-5 w-5" />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="font-medium text-emerald-700 hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-emerald-700 hover:underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
        Whose money to try
        <select
          name="person"
          defaultValue="any"
          className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="any">Surprise me</option>
          {PEOPLE.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}: {p.blurb}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending || next !== null}
        className="inline-flex h-12 items-center justify-center rounded-full border border-emerald-700 px-6 text-base font-semibold text-emerald-800 transition-colors hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-950"
      >
        {pending || next !== null ? "Setting up a sample person…" : "Try it with sample data"}
      </button>
      {state && "error" in state && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
