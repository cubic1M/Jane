import Link from "next/link";
import { LINKING_FULL_WORDS, LINKING_UPLOAD_WORDS } from "@/config/plaid-items";
import { LinkButton } from "./link-button";

export const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const PROMISES = [
  ["Read-only", "We can see transactions and balances. We can never move your money."],
  ["Through Plaid", "You sign in to your bank in Plaid's window. We never see your password."],
  ["Disconnect anytime", "Remove a bank or delete all your data whenever you want."],
];

export function Promises() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {PROMISES.map(([title, body]) => (
        <li key={title} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
        </li>
      ))}
    </ul>
  );
}

// The offer to link a new bank on /connect, or, with no slot left for this person, uploading a
// statement. Banks already linked keep their own Reconnect buttons, which never need a slot.
export function LinkChoice({
  plaidOn,
  uploadFirst,
  linkOpen,
  hasBanks,
  demoOn,
  primaryClassName,
}: {
  plaidOn: boolean;
  uploadFirst: boolean;
  linkOpen: boolean;
  hasBanks: boolean;
  demoOn: boolean;
  primaryClassName: string;
}) {
  if (plaidOn && !linkOpen) {
    // Trial people can't upload (src/lib/csv-access.ts): they keep the demo bank below.
    if (!uploadFirst) return null;
    return (
      <p data-link-full="" className="text-sm text-zinc-600 dark:text-zinc-400">
        {LINKING_FULL_WORDS}{" "}
        <Link href="/import" className="font-medium underline">
          {LINKING_UPLOAD_WORDS}
        </Link>
      </p>
    );
  }
  if (plaidOn && uploadFirst) {
    return (
      <div data-link-instead="" className="flex flex-col gap-2">
        <h2 className="font-semibold">Link your bank instead</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Read-only, through Plaid: you sign in to your bank in Plaid&apos;s window, and Jane keeps
          up with new transactions on its own.
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">How linking works</summary>
          <div className="mt-2">
            <Promises />
          </div>
        </details>
        <LinkButton
          label={hasBanks ? "Link another bank" : "Link your bank"}
          className={SECONDARY_BUTTON + " self-start"}
        />
      </div>
    );
  }
  if (plaidOn) {
    return (
      <LinkButton
        label={hasBanks ? "Add another account" : "Link an account"}
        className={primaryClassName}
      />
    );
  }
  if (!demoOn && !uploadFirst) {
    return <p className="text-zinc-600 dark:text-zinc-400">Bank linking isn&apos;t set up yet.</p>;
  }
  return null;
}
