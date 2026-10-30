"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  DOCUMENT_KINDS,
  DOCUMENT_TYPES,
  MAX_FACT_LENGTH,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  type DocumentKind,
} from "@/config/documents";
import {
  FIELD_LABELS,
  KIND_FIELDS,
  PROVIDER_LABELS,
  type DocumentFacts,
} from "@/lib/documents/facts";
import { saveFacts, uploadDocument, type FormState } from "./actions";

const INPUT =
  "h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-6 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";

function Message({ state }: { state: FormState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={state.ok ? "text-emerald-700" : "text-red-700"}
    >
      {state.message}
    </p>
  );
}

// Shows the new list (or the new facts) once a form has saved, keeping its message.
function useRefreshOnSave(state: FormState) {
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
}

export function UploadForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadDocument, null);
  useRefreshOnSave(state);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="upload-kind" className="flex flex-col gap-1 text-sm font-medium">
        What is it?
        <select id="upload-kind" name="kind" defaultValue="insurance_policy" className={INPUT}>
          {Object.entries(DOCUMENT_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="upload-file" className="flex flex-col gap-1 text-sm font-medium">
        File (PDF or a photo)
        <input
          id="upload-file"
          name="file"
          type="file"
          required
          accept={Object.keys(DOCUMENT_TYPES).join(",")}
          className="w-full min-w-0 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:font-semibold dark:file:bg-zinc-800"
        />
      </label>
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Reading it…" : "Upload"}
      </button>
      <Message state={state} />
    </form>
  );
}

const MONEY_FIELDS = new Set<keyof DocumentFacts>(["premiumCents", "purchaseAmountCents"]);
const DATE_FIELDS = new Set<keyof DocumentFacts>(["renewalDate", "warrantyEndsOn", "purchaseDate"]);

function Field({
  field,
  kind,
  documentId,
  value,
}: {
  field: keyof DocumentFacts;
  kind: DocumentKind;
  documentId: string;
  value: string;
}) {
  const id = `${documentId}-${field}`;
  const label =
    field === "provider"
      ? PROVIDER_LABELS[kind]
      : MONEY_FIELDS.has(field)
        ? `${FIELD_LABELS[field]} ($)`
        : FIELD_LABELS[field];
  const choices =
    field === "policyType"
      ? Object.entries(POLICY_TYPES)
      : field === "premiumFrequency"
        ? Object.entries(PREMIUM_FREQUENCIES).map(([key, f]) => [key, f.label] as const)
        : null;
  return (
    <label
      htmlFor={id}
      className={`flex min-w-0 flex-col gap-1 text-sm font-medium ${field === "coverageSummary" ? "sm:col-span-2" : ""}`}
    >
      {label}
      {choices ? (
        <select id={id} name={field} defaultValue={value} className={INPUT}>
          <option value="">Not sure</option>
          {choices.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field}
          defaultValue={value}
          type={DATE_FIELDS.has(field) ? "date" : "text"}
          inputMode={MONEY_FIELDS.has(field) ? "decimal" : undefined}
          maxLength={MAX_FACT_LENGTH}
          className={INPUT}
        />
      )}
    </label>
  );
}

export function FactsForm({
  documentId,
  kind,
  values,
}: {
  documentId: string;
  kind: DocumentKind;
  values: Record<keyof DocumentFacts, string>;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFacts, null);
  useRefreshOnSave(state);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="documentId" value={documentId} />
      {KIND_FIELDS[kind].map((field) => (
        <Field
          key={field}
          field={field}
          kind={kind}
          documentId={documentId}
          value={values[field]}
        />
      ))}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Saving…" : "Save facts"}
        </button>
        <Message state={state} />
      </div>
    </form>
  );
}

// The facts form, folded away unless the facts still need filling in. It remembers being
// opened, so saving (which fills them in) doesn't fold it and hide the message.
export function FactsSection({
  needsFacts,
  ...form
}: {
  needsFacts: boolean;
  documentId: string;
  kind: DocumentKind;
  values: Record<keyof DocumentFacts, string>;
}) {
  const [open, setOpen] = useState(needsFacts);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm text-emerald-700">
        {needsFacts ? "Fill in the key facts" : "Correct the facts"}
      </summary>
      <div className="mt-3">
        <FactsForm {...form} />
      </div>
    </details>
  );
}
