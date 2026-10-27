"use client";

import Link from "next/link";
import { Fragment, useRef, useState, useTransition } from "react";
import { previewImport, startImport, type PreviewResult } from "./actions";
import { ColumnPicker } from "./column-picker";
import {
  IMPORT_STARTED_EVENT,
  NEW_ACCOUNT_ID,
  SUGGESTED_UPLOAD_DAYS,
  SUGGESTED_UPLOAD_MONTHS,
} from "@/config/import";
import type { MappingChoices } from "@/data-sources/csv/column-mapping";
import { ACCOUNT_KINDS, type AccountKind } from "@/data-sources/types";
import { formatCents } from "@/lib/money";

type AccountOption = { id: string; name: string; kindLabel: string };

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const FIELD =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const SECONDARY_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function ImportForm({ accounts }: { accounts: AccountOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // Column pickers by file position, kept once shown: the import sends the picked columns too.
  const [pickers, setPickers] = useState<Record<number, MappingChoices>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The upload just saved: the rest runs in the background, followed by the chip.
  const [saved, setSaved] = useState<{ rows: number; runId: string } | null>(null);
  // A first upload makes its account from the file: its name and type come from the preview
  // until the person changes them.
  const [account, setAccount] = useState(accounts[0]?.id ?? NEW_ACCOUNT_ID);
  const [newName, setNewName] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<AccountKind | null>(null);
  // An account just added by hand is the one to upload into.
  const ids = accounts.map((a) => a.id);
  const [known, setKnown] = useState(ids);
  if (ids.join() !== known.join()) {
    setKnown(ids);
    const added = ids.find((id) => !known.includes(id));
    if (added) setAccount(added);
  }

  // The form isn't submitted natively: that would clear the chosen files after preview.
  function formData() {
    return new FormData(formRef.current ?? undefined);
  }

  function onPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await previewImport(formData());
      setPreview(result);
      if (!result.ok) return;
      setPickers((shown) => {
        const next = { ...shown };
        result.files.forEach((f, i) => {
          if (!f.ok && f.choices && !next[i]) next[i] = f.choices;
        });
        return next;
      });
    });
  }

  // Saves the rows and returns at once; the person keeps using Jane while the rest runs.
  function onConfirm() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await startImport(formData());
      if (!result.ok) return setError(result.error);
      setSaved({ rows: result.rows, runId: result.runId });
      setPreview(null);
      setPickers({});
      formRef.current?.reset();
      // The chip on every page starts following it (src/components/import-chip.tsx).
      window.dispatchEvent(new CustomEvent(IMPORT_STARTED_EVENT, { detail: result.runId }));
    });
  }

  const files = preview?.ok ? preview.files : [];
  const ready = files.length > 0 && files.every((f) => f.ok);
  const total = files.reduce((sum, f) => sum + (f.ok ? f.rowCount : 0), 0);
  const suggested = files.find((f) => f.ok)?.account;
  const days = coveredDays(files);

  return (
    <form ref={formRef} onSubmit={onPreview} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Account
        <select
          name="accountId"
          required
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className={FIELD}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.kindLabel})
            </option>
          ))}
          <option value={NEW_ACCOUNT_ID}>A new account from these files</option>
        </select>
      </label>
      {account === NEW_ACCOUNT_ID && (
        <div data-new-account="" className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Account name
            <input
              name="new.name"
              maxLength={60}
              value={newName ?? suggested?.name ?? ""}
              placeholder="Chase checking"
              onChange={(event) => setNewName(event.target.value)}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Type
            <select
              name="new.kind"
              required
              value={newKind ?? suggested?.kind ?? "checking"}
              onChange={(event) => setNewKind(event.target.value as AccountKind)}
              className={FIELD}
            >
              {Object.entries(ACCOUNT_KINDS).map(([kind, { label }]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Current balance (optional)
            <input
              name="new.balance"
              inputMode="decimal"
              placeholder="2,500.00"
              className={FIELD}
            />
          </label>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Statement files (CSV, OFX or QFX)
        <input
          name="files"
          type="file"
          accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
          multiple
          required
          onChange={() => {
            setPreview(null);
            setPickers({});
          }}
          className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:font-semibold dark:file:bg-zinc-800"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
          {pending && !preview ? "Reading…" : preview ? "Preview again" : "Preview"}
        </button>
        {ready && (
          <button type="button" onClick={onConfirm} disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? "Saving…" : `Import ${plural(total, "transaction")}`}
          </button>
        )}
      </div>
      {saved && (
        <div
          role="status"
          data-import-saved={saved.runId}
          className="flex flex-col gap-2 rounded-lg bg-zinc-100 p-4 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <p className="font-medium">
            Saved {plural(saved.rows, "transaction")}. Jane is finishing the rest in the background.
          </p>
          <p>
            Keep using Jane meanwhile: the bar at the top of every page says how it&apos;s going and
            what it found.
          </p>
          <p className="flex flex-wrap gap-4">
            <Link href="/report" className="font-medium underline">
              See your report
            </Link>
            <Link href="/home" className="font-medium underline">
              Go to Home
            </Link>
          </p>
        </div>
      )}

      {preview && !preview.ok && <Alert>{preview.error}</Alert>}
      {error && <Alert>{error}</Alert>}
      {ready && days !== null && days < SUGGESTED_UPLOAD_DAYS && (
        <p
          data-upload-months=""
          className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
        >
          These files cover {days} {days === 1 ? "day" : "days"}. Jane spots monthly charges and
          bills best with {SUGGESTED_UPLOAD_MONTHS} months, so add older statements if you can.
        </p>
      )}

      {files.map((file, index) => (
        <Fragment key={`${index}:${file.file}`}>
          {/* Always first, so it keeps what was picked when the file reads fine. */}
          {pickers[index] && (
            <ColumnPicker index={index} file={file.file} choices={pickers[index]}>
              {!file.ok && (
                <Alert>
                  {file.file}: {file.error}
                </Alert>
              )}
            </ColumnPicker>
          )}
          {file.ok ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">
                {file.file}{" "}
                <span className="font-normal text-zinc-500">
                  · {file.format} · {plural(file.rowCount, "row")}
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
            !pickers[index] && (
              <Alert>
                {file.file}: {file.error}
              </Alert>
            )
          )}
        </Fragment>
      ))}
    </form>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Days from the earliest to the latest transaction across the files, counting both ends.
function coveredDays(files: Extract<PreviewResult, { ok: true }>["files"]): number | null {
  const ok = files.flatMap((f) => (f.ok && f.from ? [f] : []));
  if (ok.length === 0) return null;
  const from = Math.min(...ok.map((f) => Date.parse(f.from)));
  const to = Math.max(...ok.map((f) => Date.parse(f.to)));
  return Math.round((to - from) / DAY_MS) + 1;
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
