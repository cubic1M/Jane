"use client";

import { useActionState } from "react";
import { submitCode, type MfaState } from "./actions";
import { BackupCodes } from "./backup-codes";

export function CodeForm({ next, allowBackup }: { next: string; allowBackup: boolean }) {
  const [state, action, pending] = useActionState<MfaState, FormData>(submitCode, null);
  if (state && "backupCodes" in state) {
    return <BackupCodes codes={state.backupCodes} next={state.next} />;
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        {allowBackup ? "6-digit code, or a backup code" : "6-digit code"}
        <input
          name="code"
          autoComplete="one-time-code"
          inputMode={allowBackup ? "text" : "numeric"}
          autoCapitalize="none"
          required
          className="h-12 rounded-lg border border-zinc-300 bg-transparent px-3 text-lg tracking-widest dark:border-zinc-700"
        />
      </label>
      {state && "message" in state && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
