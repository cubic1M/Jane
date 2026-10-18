"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  confirmTextCode,
  forgetTextNumber,
  saveTextSettings,
  sendTextCode,
  type TextsState,
} from "./texts-actions";

// Texts on /settings (spec step 78). Every form's state lives here, so a confirmation
// stays on screen when the section changes (code sent → verified).

export type TextsView = {
  mode: "imessage" | "simulated" | "off";
  phone: string | null;
  verified: boolean;
  codePending: boolean;
  enabled: boolean;
  optedOut: boolean;
  alerts: boolean;
  weeklyPlan: boolean;
  needsYou: boolean;
};

const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-10 w-fit items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const INPUT =
  "h-11 w-full max-w-xs rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

function Note({ state }: { state: TextsState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}
    >
      {state.message}
    </p>
  );
}

export function TextsForm({ view, consentText }: { view: TextsView; consentText: string }) {
  const [codeState, sendCode, sending] = useActionState<TextsState, FormData>(sendTextCode, null);
  const [verifyState, verify, verifying] = useActionState<TextsState, FormData>(
    confirmTextCode,
    null,
  );
  const [saveState, save, saving] = useActionState<TextsState, FormData>(saveTextSettings, null);
  const [forgetState, forget, forgetting] = useActionState<TextsState, FormData>(
    forgetTextNumber,
    null,
  );

  if (view.mode === "off") {
    return <p className="text-zinc-600 dark:text-zinc-400">Texts aren&apos;t available yet.</p>;
  }

  if (!view.verified) {
    return (
      <div className="flex flex-col gap-4">
        <Note state={forgetState} />
        <form action={sendCode} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Your mobile number (US)
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(415) 555-0123"
              required
              className={INPUT}
            />
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input name="consent" type="checkbox" required className="mt-1 size-5 shrink-0" />
            <span>{consentText}</span>
          </label>
          <button type="submit" disabled={sending} className={BUTTON}>
            {sending ? "Sending…" : view.codePending ? "Text me a new code" : "Text me a code"}
          </button>
          <Note state={codeState} />
        </form>
        {view.codePending && (
          <form action={verify} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              The 6-digit code we texted {view.phone}
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                required
                className={INPUT}
              />
            </label>
            <button type="submit" disabled={verifying} className={BUTTON}>
              {verifying ? "Checking…" : "Verify"}
            </button>
          </form>
        )}
        <Note state={verifyState} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Note state={verifyState} />
      <p className="text-zinc-600 dark:text-zinc-400">
        Texts go to <strong>{view.phone}</strong>
        {view.mode === "simulated" ? " (simulated here: nothing is really sent)" : ""}.
      </p>
      {view.optedOut && (
        <p role="status" className="text-sm text-amber-700">
          You replied STOP, so texts are off. Text START to Jane to turn them back on.
        </p>
      )}
      <form action={save} className="flex flex-col gap-3">
        <label className="flex items-center gap-3">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={view.enabled && !view.optedOut}
            className="size-5 shrink-0"
          />
          <span className="font-medium">Texts from Jane</span>
        </label>
        {(
          [
            ["alerts", "Urgent alerts", view.alerts],
            ["weeklyPlan", "Your weekly plan, to answer YES, the numbers or NO", view.weeklyPlan],
            ["needsYou", "When something needs you", view.needsYou],
          ] as const
        ).map(([name, label, checked]) => (
          <label key={name} className="ml-8 flex items-center gap-3 text-sm">
            <input name={name} type="checkbox" defaultChecked={checked} className="size-5" />
            {label}
          </label>
        ))}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No texts between 9pm and 8am your time; they wait until morning.
        </p>
        <button type="submit" disabled={saving} className={SECONDARY}>
          {saving ? "Saving…" : "Save"}
        </button>
        <Note state={saveState} />
      </form>
      <form action={forget} className="flex flex-col gap-2">
        <button type="submit" disabled={forgetting} className={SECONDARY}>
          Remove my number
        </button>
        <Note state={forgetState} />
      </form>
      {view.mode === "simulated" && (
        <Link
          href="/settings/texts"
          className="text-sm font-medium text-emerald-700 hover:underline"
        >
          Open the simulated phone to try replying
        </Link>
      )}
    </div>
  );
}
