"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { flushSync, useFormStatus } from "react-dom";

// A form's submit button that answers the tap at once (the founder's "every button is an
// instant response"): the press itself shows a spinner, in the same frame, and from then until
// the server action returns the form can't be sent twice. The spinner is plain text, so it
// needs no colour, and screen readers hear "busy" from aria-busy. Only the button that was
// pressed spins, when a form has two. Drop-in for <button type="submit">: every other prop
// passes through.

const FRAMES = ["|", "/", "-", "\\"];
// A press that sends nothing (a required field left empty) stops spinning after this long.
const UNSENT_MS = 400;

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
  const sent = useRef(false);

  useEffect(() => {
    if (pending) {
      sent.current = true;
      return;
    }
    // The server answered: the next press starts afresh.
    if (sent.current) {
      sent.current = false;
      setPressed(false);
      return;
    }
    if (!pressed) return;
    const id = window.setTimeout(() => setPressed(false), UNSENT_MS);
    return () => window.clearTimeout(id);
  }, [pending, pressed]);

  return (
    <button
      type="submit"
      {...props}
      // Only once the form is on its way: disabling the button during the press would cancel it.
      disabled={disabled || pending}
      aria-busy={pressed || undefined}
      onClick={(e) => {
        // Painted before the form starts its work, so the press shows in the same frame.
        flushSync(() => setPressed(true));
        onClick?.(e);
      }}
    >
      {children}
      {pressed && (
        <>
          {" "}
          <Spinner />
        </>
      )}
    </button>
  );
}
