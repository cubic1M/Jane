"use client";

import { useRef, useState, useTransition } from "react";
import { confirmImport, previewImport, type PreviewResult } from "./actions";
import { formatCents } from "@/lib/money";

type AccountOption = { id: string; name: string; kindLabel: string };

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function ImportForm({ accounts }: { accounts: AccountOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The form isn't submitted natively: that would clear the chosen files after preview.
  function formData() {
    return new FormData(formRef.current ?? undefined);
  }

  function onPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => setPreview(await previewImport(formData())));
  }

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmImport(formData());
      if (!result.ok) setError(result.error);
    });
  }

  const files = preview?.ok ? preview.files : [];
  const ready = files.length > 0 && files.every((f) => f.ok);
  const total = files.reduce((sum, f) => sum + (f.ok ? f.rowCount : 0), 0);

  return (
    <form ref={formRef} onSubmit={onPreview} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Account
        <select
          name="accountId"
          required
          className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.kindLabel})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        CSV files
        <input
          name="files"
          type="file"
          accept=".csv,text/csv"
          multiple
          required
          onChange={() => setPreview(null)}
          className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:font-semibold dark:file:bg-zinc-800"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
          {pending && !preview ? "Reading…" : "Preview"}
        </button>
        {ready && (
          <button type="button" onClick={onConfirm} disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? "Importing…" : `Import ${total} transactions`}
          </button>
        )}
      </div>

      {preview && !preview.ok && <Alert>{preview.error}</Alert>}
      {error && <Alert>{error}</Alert>}

      {files.map((file) =>
        file.ok ? (
          <section key={file.file} className="flex flex-col gap-2">
            <h3 className="font-semibold">
              {file.file}{" "}
              <span className="font-normal text-zinc-500">
                · {file.format} · {file.rowCount} rows
              </span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Date</th>
                    <th className="py-1 pr-3 font-medium">Description</th>
                    <th className="py-1 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {file.sample.map((row, i) => (
                    <tr key={i} className="border-t border-zinc-100 dark:border-zinc-900">
                      <td className="py-1 pr-3 whitespace-nowrap">{row.date}</td>
                      <td className="py-1 pr-3">{row.description}</td>
                      <td className="py-1 text-right whitespace-nowrap">
                        {/* Positive amounts are money out; show them as negative like a bank does. */}
                        {formatCents(-row.amountCents || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {file.rowCount > file.sample.length && (
              <p className="text-xs text-zinc-500">
                Showing {file.sample.length} of {file.rowCount} rows.
              </p>
            )}
            {file.skipped.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-medium">
                  {file.skipped.length} row{file.skipped.length === 1 ? "" : "s"} will be skipped:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {file.skipped.map((s) => (
                    <li key={s.line}>
                      Line {s.line}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : (
          <Alert key={file.file}>
            {file.file}: {file.error}
          </Alert>
        ),
      )}
    </form>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {children}
    </p>
  );
}
