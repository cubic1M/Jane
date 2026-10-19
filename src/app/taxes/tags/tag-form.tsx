"use client";

import { useActionState } from "react";
import { TAX_TAG_ORDER, TAX_TAGS, UNTAGGED, type TaxTagKind } from "@/config/tax";
import { changeTag, type TagState } from "./actions";

// One tag to change (spec step 119): a transaction's, or a whole merchant's.

const SELECT =
  "h-11 max-w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-400 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900";

export function TagForm({
  target,
  current,
  label,
}: {
  target: { transactionId: string } | { merchantKey: string };
  current: TaxTagKind | null;
  // What it's for, for screen readers: "Tax tag for MasterClass, Oct 9".
  label: string;
}) {
  const [state, action, pending] = useActionState<TagState, FormData>(changeTag, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {"transactionId" in target ? (
        <input type="hidden" name="transactionId" value={target.transactionId} />
      ) : (
        <input type="hidden" name="merchantKey" value={target.merchantKey} />
      )}
      <select name="tag" defaultValue={current ?? UNTAGGED} aria-label={label} className={SELECT}>
        {TAX_TAG_ORDER.map((tag) => (
          <option key={tag} value={tag}>
            {TAX_TAGS[tag].label}
          </option>
        ))}
        <option value={UNTAGGED}>Not for taxes</option>
      </select>
      <button type="submit" disabled={pending} className={BUTTON}>
        Save
      </button>
      <span role="status" className={state?.ok === false ? "text-sm text-red-700" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}

// "Yes, it counts" / "No" on a merchant Jane is unsure about.
export function CheckButtons({ merchantKey, tag }: { merchantKey: string; tag: TaxTagKind }) {
  const [state, action, pending] = useActionState<TagState, FormData>(changeTag, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="merchantKey" value={merchantKey} />
      <button
        type="submit"
        name="tag"
        value={tag}
        disabled={pending}
        className="inline-flex h-11 items-center rounded-full bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        Yes, keep it
      </button>
      <button type="submit" name="tag" value={UNTAGGED} disabled={pending} className={BUTTON}>
        No, not for taxes
      </button>
      <span role="status" className={state?.ok === false ? "text-sm text-red-700" : "text-sm"}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}
