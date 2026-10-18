"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function MembershipOffer({
  savedLabel,
  priceLabel,
}: {
  savedLabel: string | null;
  // Null when Stripe isn't set up: then only Reserve is offered.
  priceLabel: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string) {
    setBusy(true);
    setError(null);
    const response = await fetch(path, { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response?.ok) {
      setError(body?.error ?? "Something went wrong. Try again.");
      setBusy(false);
      return;
    }
    if (body.url) {
      window.location.assign(body.url);
      return;
    }
    router.refresh();
  }

  return (
    <section
      aria-label="Membership"
      className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950"
    >
      <h2 className="text-lg font-semibold">We&apos;ll keep doing this for you, ongoing.</h2>
      <p className="text-zinc-700 dark:text-zinc-300">
        {savedLabel ? `So far we've saved you about ${savedLabel} a year. ` : ""}
        Members get new savings found and handled every month.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {priceLabel && (
          <button
            type="button"
            disabled={busy}
            onClick={() => post("/api/membership/checkout")}
            className={PRIMARY}
          >
            Become a founding member ({priceLabel})
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => post("/api/membership/reserve")}
          className={priceLabel ? SECONDARY : PRIMARY}
        >
          Reserve my spot (free)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => post("/api/membership/dismiss")}
          className="text-sm text-zinc-500 hover:underline"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
