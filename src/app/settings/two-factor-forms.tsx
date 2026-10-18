"use client";

import { useActionState } from "react";
import { BackupCodes } from "@/app/mfa/backup-codes";
import { makeBackupCodes, turnOff, type TwoFactorState } from "./two-factor-actions";

const FIELD =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 tracking-widest dark:border-zinc-700";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function CodeAction({
  action: serverAction,
  label,
  fieldLabel,
}: {
  action: (state: TwoFactorState, data: FormData) => Promise<TwoFactorState>;
  label: string;
  fieldLabel: string;
}) {
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(serverAction, null);
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {fieldLabel}
          <input name="code" autoComplete="one-time-code" required className={FIELD} />
        </label>
        <button type="submit" disabled={pending} className={BUTTON}>
          {label}
        </button>
      </form>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700 dark:text-red-400"}`}
        >
          {state.message}
        </p>
      )}
      {state?.codes && <BackupCodes codes={state.codes} />}
    </div>
  );
}

export function TwoFactorOnForms({ canTurnOff }: { canTurnOff: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <CodeAction
        action={makeBackupCodes}
        label="Make new backup codes"
        fieldLabel="Current code, for new backup codes"
      />
      {canTurnOff && (
        <CodeAction
          action={turnOff}
          label="Turn off two-factor"
          fieldLabel="Current code, to turn it off"
        />
      )}
    </div>
  );
}
