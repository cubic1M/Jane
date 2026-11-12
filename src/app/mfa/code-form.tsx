"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitCode, type MfaState } from "./actions";
import { BackupCodes } from "./backup-codes";

// `done`: the code is already in for this session. The page renders that once the first code
// turns two-factor on, and it must not take the backup codes away (beta walk 11-12: its redirect
// did, and Settings said "10 backup codes left" for codes nobody had seen). So this form stays in
// place and keeps the codes until the person moves on.
export function CodeForm({
  next,
  allowBackup,
  done = false,
}: {
  next: string;
  allowBackup: boolean;
  done?: boolean;
}) {
  const [state, action, pending] = useActionState<MfaState, FormData>(submitCode, null);
  if (state && "backupCodes" in state) {
    return <BackupCodes codes={state.backupCodes} next={state.next} />;
  }
  if (done) {
    return (
      <Link
        href={next}
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-zinc-900 px-6 font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Continue
      </Link>
    );
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
