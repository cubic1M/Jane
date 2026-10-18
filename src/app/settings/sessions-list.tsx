"use client";

import { useActionState, useState } from "react";
import type { DeviceSession } from "@/lib/user-sessions";
import { signOutDevice, signOutOthers, type SessionsState } from "./session-actions";

// Devices and sessions (spec step 73). Only row ids and labels reach the page, never a
// session token. Signed-out rows are hidden here rather than by reloading the page, so
// the confirmation stays visible.

const QUIET =
  "inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function SessionsList({ sessions }: { sessions: DeviceSession[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [state, action, pending] = useActionState<SessionsState, FormData>(
    async (previous, data) => {
      const others = data.get("scope") === "others";
      const result = others ? await signOutOthers() : await signOutDevice(previous, data);
      if (result?.ok) {
        const ended = others
          ? sessions.filter((s) => !s.current).map((s) => s.id)
          : [String(data.get("sessionId"))];
        setHidden((ids) => [...ids, ...ended]);
      }
      return result;
    },
    null,
  );
  const shown = sessions.filter((s) => !hidden.includes(s.id));
  const othersLeft = shown.some((s) => !s.current);

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
        {shown.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="font-medium">{s.device}</span>
              {s.current && (
                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  This device
                </span>
              )}
              <span className="block text-xs text-zinc-500">
                Signed in {s.signedIn} · {s.lastActive}
              </span>
            </span>
            {!s.current && (
              <form action={action}>
                <input type="hidden" name="sessionId" value={s.id} />
                <button
                  type="submit"
                  disabled={pending}
                  className={QUIET}
                  aria-label={`Sign out ${s.device}, signed in ${s.signedIn}`}
                >
                  Sign out
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {othersLeft && (
        <form action={action}>
          <input type="hidden" name="scope" value="others" />
          <button type="submit" disabled={pending} className={QUIET}>
            {pending ? "Signing out…" : "Sign out other devices"}
          </button>
        </form>
      )}
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700 dark:text-red-400"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
