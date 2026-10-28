"use client";

import { useState, useTransition } from "react";
import {
  removeAccountAction,
  removeEarlierRowsAction,
  removeUploadAction,
  startOverAction,
  type ActionResult,
} from "./actions";
import { BalanceAskForm } from "./balance-ask";
import { IMPORT_STARTED_EVENT } from "@/config/import";
import { dayLabel } from "@/lib/day-label";
import type { BalanceAsk } from "@/lib/import/balance-question";
import { formatCents } from "@/lib/money";
import type { EarlierRows, UploadView } from "@/lib/import/remove";

// What's been uploaded, and taking it back (src/lib/import/remove.ts): one upload's rows, an
// uploaded account with everything in it, or everything uploaded ("Start over"). Each asks
// first, saying what goes. The numbers are worked out again in the background, followed by the
// chip at the top of the page.

type Account = {
  id: string;
  name: string;
  rows: number;
  kindLabel: string;
  credit: boolean;
  balanceCents: number | null;
  firstDate: string | null;
  lastDate: string | null;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// "Jul 28 to Oct 20, 2026", as the rest of the page writes dates.
// Dates read as the account list writes them, each with its year: "Jul 29, 2026 to Oct 24,
// 2026" (overnight beta list).
const range = (from: string | null, to: string | null) =>
  from && to
    ? from === to
      ? dayLabel(from, { year: true })
      : `${dayLabel(from, { year: true })} to ${dayLabel(to, { year: true })}`
    : "no dates";

const BUTTON =
  "inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

// A button that asks before it removes anything. `what` names what it removes, for a screen
// reader beside the rows' identical buttons ("Remove this upload: wells-fargo.csv").
function Confirm({
  label,
  what,
  question,
  yes,
  run,
}: {
  label: string;
  what?: string;
  question: string;
  yes: string;
  run: () => Promise<ActionResult>;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!asking) {
    return (
      <button
        type="button"
        className={BUTTON}
        aria-label={what ? `${label}: ${what}` : undefined}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2 text-sm">
      <p>{question}</p>
      <div className="flex flex-wrap gap-2">
        {/* Focus moves to the question's answer: the button pressed is gone. */}
        <button
          type="button"
          autoFocus
          disabled={pending}
          className={`${BUTTON} border-zinc-900 font-semibold dark:border-zinc-100`}
          onClick={() =>
            startTransition(async () => {
              const result = await run();
              if (!result.ok) return setError(result.error);
              setAsking(false);
              window.dispatchEvent(new CustomEvent(IMPORT_STARTED_EVENT));
            })
          }
        >
          {pending ? "Removing…" : yes}
        </button>
        <button
          type="button"
          disabled={pending}
          className={BUTTON}
          onClick={() => setAsking(false)}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="font-medium text-zinc-900 dark:text-zinc-100">
          {error}
        </p>
      )}
    </div>
  );
}

export function UploadHistory({
  uploads,
  earlier,
  accounts,
  totals,
  asks = [],
}: {
  uploads: UploadView[];
  earlier: EarlierRows[];
  accounts: Account[];
  totals: { accounts: number; rows: number };
  // Uploaded accounts still without a balance: asked for here too.
  asks?: BalanceAsk[];
}) {
  if (accounts.length === 0) return null;
  return (
    <section data-upload-history="" className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Your uploads</h2>
      <ul className="flex flex-col gap-3">
        {uploads.map((u) => (
          <li
            key={u.id}
            data-upload={u.id}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <p className="font-medium">{u.fileNames.join(", ") || "Statement"}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {u.accountName} · {range(u.from, u.to)} · {plural(u.rows, "transaction")} added{" "}
              {dayLabel(new Date(u.at), { year: true })}
            </p>
            <Confirm
              label="Remove this upload"
              what={u.fileNames.join(", ") || u.accountName}
              question={`Remove the ${plural(u.rows, "transaction")} this upload added to ${u.accountName}? Rows from your other uploads stay.`}
              yes="Yes, remove them"
              run={() => removeUploadAction(u.id)}
            />
          </li>
        ))}
        {earlier.map((e) => (
          <li
            key={`earlier-${e.accountId}`}
            className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <p className="font-medium">Earlier uploads</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {e.accountName} · {range(e.from, e.to)} · {plural(e.rows, "row")}
            </p>
            <Confirm
              label="Remove these"
              what={`earlier rows of ${e.accountName}`}
              question={`Remove the ${plural(e.rows, "transaction")} uploaded to ${e.accountName} before uploads were listed here?`}
              yes="Yes, remove them"
              run={() => removeEarlierRowsAction(e.accountId)}
            />
          </li>
        ))}
      </ul>

      <h3 className="font-semibold">Your accounts</h3>
      {asks.length > 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {asks.length === 1
            ? "One account has no balance yet. Add it below and net worth counts it."
            : `${asks.length} accounts have no balance yet. Add them below and net worth counts them.`}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {accounts.map((a) => (
          <li
            key={a.id}
            data-uploaded-account={a.id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="flex flex-col">
              <span className="font-medium" data-private>
                {a.name}
              </span>
              <span className="text-sm text-zinc-500">
                {a.kindLabel} · {plural(a.rows, "transaction")}
                {a.firstDate && a.lastDate && ` · ${range(a.firstDate, a.lastDate)}`}
                {a.balanceCents !== null &&
                  ` · ${a.credit ? "Owed" : "Balance"} ${formatCents(a.balanceCents)}`}
              </span>
            </span>
            {asks.some((ask) => ask.accountId === a.id) && (
              <div className="w-full">
                <BalanceAskForm
                  ask={asks.find((ask) => ask.accountId === a.id)!}
                  skippable={false}
                  explain={false}
                />
              </div>
            )}
            <Confirm
              label="Remove account"
              what={a.name}
              question={`Remove ${a.name} and all ${plural(a.rows, "transaction")} in it?`}
              yes="Yes, remove the account"
              run={() => removeAccountAction(a.id)}
            />
          </li>
        ))}
      </ul>

      <div
        data-start-over=""
        className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
      >
        <Confirm
          label="Start over"
          question={`This deletes your ${plural(totals.accounts, "uploaded account")} and ${totals.accounts === 1 ? "its" : "their"} ${plural(totals.rows, "transaction")}. Linked banks and your settings stay. Then you can upload again from scratch.`}
          yes="Yes, delete my uploads"
          run={() => startOverAction()}
        />
      </div>
    </section>
  );
}
