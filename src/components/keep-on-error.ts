"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";

// React empties an uncontrolled form once its action finishes, even when the action answered
// "that isn't valid": the person's typed answers vanish with the error message. Submitting through
// the action (not the form's `action` prop) keeps what they typed. `resetOnOk` clears the form
// after a save that should start the next entry empty.
export function useKeepOnError(
  run: (formData: FormData) => void,
  state: { ok: boolean } | null,
  { resetOnOk = false }: { resetOnOk?: boolean } = {},
) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnOk && state?.ok) ref.current?.reset();
  }, [resetOnOk, state]);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => run(formData));
  };
  // `method`: before the page's script has loaded a submit goes as a POST, never into the address
  // bar where a tax figure or a signature would be seen.
  return { ref, onSubmit, method: "post" as const };
}
