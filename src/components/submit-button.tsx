"use client";

import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

// A form's submit button that answers the tap at once (the founder's "every button is an
// instant response"): from the press until the server action returns, it shows a spinner and
// can't be pressed twice. The spinner is plain text, so it needs no colour and screen readers
// hear "working" from aria-busy. Only the button that was pressed spins, when a form has two.
// Drop-in for <button type="submit">: every other prop passes through.

const FRAMES = ["|", "/", "-", "\\"];

export function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 120);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span aria-hidden className="inline-block w-[1ch] font-mono">
      {FRAMES[frame]}
    </span>
  );
}

export function SubmitButton({
  children,
  disabled,
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { pending } = useFormStatus();
  const [pressed, setPressed] = useState(false);
  // The form is done: the next press starts afresh.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => (pending ? undefined : setPressed(false)), [pending]);
  const busy = pending && pressed;
  return (
    <button
      type="submit"
      {...props}
      disabled={disabled || pending}
      aria-busy={busy || undefined}
      onClick={(e) => {
        setPressed(true);
        onClick?.(e);
      }}
    >
      {children}
      {busy && (
        <>
          {" "}
          <Spinner />
        </>
      )}
    </button>
  );
}
