"use client";

import { useActionState } from "react";
import { identityAction, type IdentityState } from "./actions";
import { FormStatus } from "@/components/form-status";

const BUTTON =
  "inline-flex h-11 items-center justify-center self-start rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60";
const SECOND =
  "inline-flex h-11 items-center justify-center self-start rounded-full border border-zinc-400 px-5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-900";

export function PinButtons({ canRemind }: { canRemind: boolean }) {
  const [state, action, pending] = useActionState<IdentityState, FormData>(identityAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {canRemind && (
        <button type="submit" name="intent" value="remind" disabled={pending} className={BUTTON}>
          Remind me
        </button>
      )}
      <button type="submit" name="intent" value="have" disabled={pending} className={SECOND}>
        I have it
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function SignButtons({ signs }: { signs: { key: string; title: string }[] }) {
  const [state, action, pending] = useActionState<IdentityState, FormData>(identityAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="open" />
      {signs.map((s) => (
        <button
          key={s.key}
          type="submit"
          name="sign"
          value={s.key}
          disabled={pending}
          className={SECOND}
        >
          {s.title}
        </button>
      ))}
      <FormStatus state={state} />
    </form>
  );
}

export function StepButton({ step, title }: { step: string; title: string }) {
  const [state, action, pending] = useActionState<IdentityState, FormData>(identityAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="intent" value="step" />
      <input type="hidden" name="step" value={step} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`I've done it: ${title}`}
        className={BUTTON}
      >
        I&apos;ve done it
      </button>
      <FormStatus state={state} />
    </form>
  );
}
