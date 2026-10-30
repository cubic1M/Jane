"use client";

import { useActionState } from "react";
import { savePartner, type PartnerState } from "./actions";

export type PartnerFormValues = {
  id: string;
  key: string;
  name: string;
  actionType: string;
  disclosure: string;
  referralUrl: string;
  allowedStates: string;
  revenuePerConversion: string;
  active: boolean;
};

const INPUT =
  "rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";

export function PartnerForm({
  values,
  actionTypes,
}: {
  values: PartnerFormValues;
  actionTypes: readonly string[];
}) {
  const [state, action, pending] = useActionState<PartnerState, FormData>(savePartner, null);
  const id = (name: string) => `${values.id || "new"}-${name}`;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={values.id} />
      <label htmlFor={id("name")} className="flex flex-col gap-1 text-xs font-medium">
        Name
        <input id={id("name")} name="name" defaultValue={values.name} className={INPUT} />
      </label>
      <label htmlFor={id("key")} className="flex flex-col gap-1 text-xs font-medium">
        Key
        <input id={id("key")} name="key" defaultValue={values.key} className={INPUT} />
      </label>
      <label htmlFor={id("actionType")} className="flex flex-col gap-1 text-xs font-medium">
        Action
        <select
          id={id("actionType")}
          name="actionType"
          defaultValue={values.actionType}
          className={INPUT}
        >
          {actionTypes.map((t) => (
            <option key={t} value={t}>
              {t.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={id("referralUrl")} className="flex flex-col gap-1 text-xs font-medium">
        Referral link
        <input
          id={id("referralUrl")}
          name="referralUrl"
          defaultValue={values.referralUrl}
          className={INPUT}
        />
      </label>
      <label
        htmlFor={id("disclosure")}
        className="flex flex-col gap-1 text-xs font-medium sm:col-span-2"
      >
        Disclosure (shown on the card word for word)
        <textarea
          id={id("disclosure")}
          name="disclosure"
          rows={2}
          defaultValue={values.disclosure}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("allowedStates")} className="flex flex-col gap-1 text-xs font-medium">
        States where it&apos;s allowed (e.g. CA, NY)
        <input
          id={id("allowedStates")}
          name="allowedStates"
          defaultValue={values.allowedStates}
          className={INPUT}
        />
      </label>
      <label
        htmlFor={id("revenuePerConversion")}
        className="flex flex-col gap-1 text-xs font-medium"
      >
        Revenue per conversion ($)
        <input
          id={id("revenuePerConversion")}
          name="revenuePerConversion"
          defaultValue={values.revenuePerConversion}
          className={INPUT}
        />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={values.active} className="h-4 w-4" />
        On (offered on cards)
      </label>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm sm:col-span-2 ${state.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : values.id ? "Save" : "Add partner"}
      </button>
    </form>
  );
}
