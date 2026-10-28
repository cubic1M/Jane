"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { importPositions, previewPositions, type PositionsPreviewResult } from "./actions";
import { MAX_UPLOAD_BYTES, uploadTooBig } from "@/config/import";
import { POSITIONS_SUBTYPES } from "@/config/positions-import";
import { dayLabel } from "@/lib/day-label";
import type { PositionsImportResult } from "@/lib/import/positions";
import { formatCents } from "@/lib/money";

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const FIELD =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

const FAILED = "Jane couldn't read these files just now. Try again.";

// The investments upload: a brokerage's positions download, previewed account by account (with
// the account type to check), then saved. Like the statements form, it's never submitted
// natively, so the chosen files stay after the preview.
export function PositionsForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PositionsPreviewResult | null>(null);
  const [saved, setSaved] = useState<Extract<PositionsImportResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [pending, startTransition] = useTransition();

  function formData(): FormData | null {
    const data = new FormData(formRef.current ?? undefined);
    const bytes = data
      .getAll("files")
      .reduce((sum, f) => sum + (f instanceof File ? f.size : 0), 0);
    if (bytes > MAX_UPLOAD_BYTES) {
      setError(uploadTooBig(bytes));
      return null;
    }
    return data;
  }

  function onPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("preview");
    setError(null);
    setSaved(null);
    const data = formData();
    if (!data) return setPreview(null);
    startTransition(async () => {
      const result = await previewPositions(data)
        .catch(() => previewPositions(data))
        .catch(() => null);
      if (!result) return setError(FAILED);
      if (!result.ok) return setError(result.error);
      setPreview(result);
    });
  }

  function onImport() {
    setBusy("import");
    setError(null);
    const data = formData();
    if (!data) return;
    startTransition(async () => {
      const result = await importPositions(data).catch(() => null);
      if (!result) return setError(FAILED);
      if (!result.ok) return setError(result.error);
      setSaved(result);
      setPreview(null);
    });
  }

  const files = preview?.ok ? preview.files : [];
  const readable = files.length > 0 && files.every((f) => f.ok);

  return (
    <form ref={formRef} onSubmit={onPreview} data-positions-form="" className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Positions files
        <input
          type="file"
          name="files"
          accept=".csv,text/csv"
          multiple
          required
          className="text-sm"
          onChange={() => {
            setPreview(null);
            setSaved(null);
          }}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
          {pending && busy === "preview" ? "Reading…" : "Preview"}
        </button>
        {readable && (
          <button
            type="button"
            onClick={onImport}
            disabled={pending}
            className={PRIMARY_BUTTON}
            data-positions-import=""
          >
            {pending && busy === "import" ? "Saving…" : "Import holdings"}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {error}
        </p>
      )}

      {files.map((file) =>
        file.ok ? (
          <div
            key={file.file}
            data-positions-preview=""
            className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <p className="text-sm">
              <span className="font-semibold">{file.file}</span>: {file.layout}
              {file.asOf ? `, as of ${dayLabel(file.asOf, { year: true })}` : ""}
              {file.skipped > 0
                ? `. ${file.skipped} ${file.skipped === 1 ? "row" : "rows"} left out (pending activity or options).`
                : "."}
            </p>
            {file.notes.map((note) => (
              <p key={note} className="text-sm text-zinc-600 dark:text-zinc-400">
                {note}
              </p>
            ))}
            {file.accounts.map((a) => (
              <div
                key={a.key}
                className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{a.name}</p>
                  <p className="tabular-nums">{formatCents(a.valueCents)}</p>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {a.holdings} {a.holdings === 1 ? "holding" : "holdings"}
                  {a.cashCents > 0 ? `, ${formatCents(a.cashCents)} of it cash` : ""}
                  {a.replaces ? ". Replaces what Jane has for this account." : "."}
                </p>
                <ul className="text-sm text-zinc-600 dark:text-zinc-400">
                  {a.largest.map((h) => (
                    <li key={`${h.ticker}-${h.name}`}>
                      {h.ticker ? `${h.ticker}: ` : ""}
                      {h.name}, {formatCents(h.valueCents)}
                    </li>
                  ))}
                </ul>
                <label className="flex flex-col gap-1 text-sm">
                  Account type
                  <select name={`subtype.${a.key}`} defaultValue={a.subtype} className={FIELD}>
                    {POSITIONS_SUBTYPES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
        ) : (
          <p key={file.file} role="alert" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {file.file}: {file.error}
          </p>
        ),
      )}

      {saved && (
        <p data-positions-saved="" className="text-sm">
          Saved {saved.holdings} {saved.holdings === 1 ? "holding" : "holdings"} in {saved.accounts}{" "}
          {saved.accounts === 1 ? "account" : "accounts"}, worth {formatCents(saved.valueCents)}.{" "}
          <Link href="/investments" className="font-semibold underline">
            See your investments
          </Link>
        </p>
      )}
    </form>
  );
}
