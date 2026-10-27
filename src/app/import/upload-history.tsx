"use client";

import { useState, useTransition } from "react";
import {
  removeAccountAction,
  removeEarlierRowsAction,
  removeUploadAction,
  startOverAction,
  type ActionResult,
} from "./actions";
import { IMPORT_STARTED_EVENT } from "@/config/import";
import type { EarlierRows, UploadView } from "@/lib/import/remove";

// What's been uploaded, and taking it back (src/lib/import/remove.ts): one upload's rows, an
// uploaded account with everything in it, or everything uploaded ("Start over"). Each asks
// first, saying what goes. The numbers are worked out again in the background, followed by the
// chip at the top of the page.

type Account = { id: string; name: string; rows: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const range = (from: string | null, to: string | null) =>
  from && to ? (from === to ? from : `${from} to ${to}`) : "no dates";

const BUTTON =
  "inline-flex h-9 items-center rounded-full border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

// A button that asks before it removes anything.
function Confirm({
  label,
  question,
  yes,
  run,
}: {
  label: string;
  question: string;
  yes: string;
  run: () => Promise<ActionResult>;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!asking) {
    return (
      <button type="button" className={BUTTON} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2 text-sm">
      <p>{question}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
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
}: {
  uploads: UploadView[];
  earlier: EarlierRows[];
  accounts: Account[];
  totals: { accounts: number; rows: number };
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
              {u.accountName} · {range(u.from, u.to)} · {plural(u.rows, "row")} added ·{" "}
              {new Date(u.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </p>
            <Confirm
              label="Remove this upload"
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
              question={`Remove the ${plural(e.rows, "transaction")} uploaded to ${e.accountName} before uploads were listed here?`}
              yes="Yes, remove them"
              run={() => removeEarlierRowsAction(e.accountId)}
            />
          </li>
        ))}
      </ul>

      <h3 className="font-semibold">Uploaded accounts</h3>
      <ul className="flex flex-col gap-3">
        {accounts.map((a) => (
          <li
            key={a.id}
            data-uploaded-account={a.id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              {a.name}{" "}
              <span className="text-sm text-zinc-500">· {plural(a.rows, "transaction")}</span>
            </span>
            <Confirm
              label="Remove account"
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
          question={`This deletes your ${plural(totals.accounts, "uploaded account")} and their ${plural(totals.rows, "transaction")}. Linked banks and your settings stay. Then you can upload again from scratch.`}
          yes="Yes, delete my uploads"
          run={() => startOverAction()}
        />
      </div>
    </section>
  );
}
