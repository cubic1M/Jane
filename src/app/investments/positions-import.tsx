"use client";

import { useState, useTransition } from "react";
import { IMPORT_STARTED_EVENT } from "@/config/import";
import { formatCents } from "@/lib/money";
import { importPositionsAction, type PositionsActionResult } from "./positions-actions";

// "Add what you own": the positions download from Fidelity, Schwab, Vanguard or Robinhood. Jane
// reads it here and keeps the holdings, not the file.

const BUTTON =
  "inline-flex h-11 items-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function PositionsImportForm() {
  const [result, setResult] = useState<PositionsActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setResult(null);
        startTransition(async () => {
          const r = await importPositionsAction(data);
          setResult(r);
          if (r.ok) window.dispatchEvent(new CustomEvent(IMPORT_STARTED_EVENT));
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Add what you own
        <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
          Download the positions (holdings) list from Fidelity, Schwab, Vanguard or Robinhood and
          choose it here. Jane reads it on the spot and keeps what you hold, not the file.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          aria-label="Positions file"
          className="text-sm"
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Reading…" : "Add it"}
        </button>
      </div>
      {result && !result.ok && (
        <p role="alert" className="text-sm font-medium">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <ul role="status" className="text-sm">
          {result.accounts.map((a) => (
            <li key={a.name}>
              {a.name}: {a.holdings} {a.holdings === 1 ? "holding" : "holdings"},{" "}
              {formatCents(a.valueCents)}.
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
