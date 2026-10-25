"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { PEOPLE } from "@/config/people";
import { tryJane, type TryState } from "@/app/try/actions";

// "Try it with sample data" on the landing page (spec step 138): a sample person with fake
// data, deleted after a day. Agreeing to the Terms first, as at sign-up. In the landing page's own
// colours (src/app/landing.css), the one page exempt from black and white.
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
    // At most the screen's width: the people's long descriptions in the picker would otherwise
    // widen it past a phone's edge, button and all (phone walk, 375 px).
    <form action={action} className="flex w-full max-w-md min-w-0 flex-col gap-2">
      <label className="flex items-start gap-2 text-sm text-[var(--landing-mid)]">
        <input
          type="checkbox"
          name="consent"
          required
          className="mt-0.5 h-5 w-5 accent-[var(--landing-hi)]"
        />
        <span>
          I agree to the{" "}
          <Link
            href="/terms"
            className="font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
          >
            Terms
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
          >
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--landing-mid)]">
        Whose money to try
        <select
          name="person"
          defaultValue="any"
          className="h-11 w-full min-w-0 border border-[var(--landing-dot)] bg-[var(--landing-bg)] px-3 text-base text-[var(--landing-hi)]"
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
        className="inline-flex h-12 items-center justify-center border border-[var(--landing-hi)] px-6 text-base font-semibold text-[var(--landing-hi)] transition-colors hover:bg-[var(--landing-hi)] hover:text-[var(--landing-bg)] disabled:opacity-60"
      >
        {pending || next !== null ? "Setting up a sample person…" : "Try it with sample data"}
      </button>
      {state && "error" in state && (
        <p role="alert" className="text-sm text-[var(--landing-hi)]">
          {state.error}
        </p>
      )}
    </form>
  );
}
