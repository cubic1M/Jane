"use client";

import { useActionState, useState } from "react";
import { INVOICE_MAX_CHARS } from "@/config/agent-chat";
import { readInvoice, type InvoiceState } from "./actions";

// Paste an invoice's text, see its line items. Nothing is kept.
export function InvoiceForm({ charge }: { charge: string | null }) {
  const [state, action, pending] = useActionState<InvoiceState, FormData>(readInvoice, null);
  // Kept here, not in the field: React empties an uncontrolled field after a form action, so a
  // pasted invoice that can't be read would be lost just when it needs fixing.
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2">
        {charge && <input type="hidden" name="charge" value={charge} />}
        <label className="flex flex-col gap-1 text-sm font-medium">
          The invoice&apos;s text
          <textarea
            name="invoice"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            maxLength={INVOICE_MAX_CHARS}
            placeholder={"Pro plan   $20.00\nBandwidth, 150 GB   $60.00\nTotal   $80.00"}
            className="rounded-lg border border-zinc-300 px-3 py-2 font-normal dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 self-start rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Reading…" : "Read it"}
        </button>
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm font-medium">
          {state.message}
        </p>
      )}
      {state?.ok && (
        <div role="status" className="flex flex-col gap-1 text-sm">
          {state.lines.map((line, i) => (
            <p key={`${i}-${line}`}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
