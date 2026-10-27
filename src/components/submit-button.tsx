"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { flushSync, useFormStatus } from "react-dom";

// A form's submit button that answers the tap at once (the founder's "every button is an
// instant response"): the press itself shows a thin progress bar along the button's bottom
// edge, in the same frame, and from then until the server action returns the form can't be
// sent twice. The bar takes the button's own text colour, so it fits every style, and screen
// readers hear "busy" from aria-busy. Only the button that was pressed shows it, when a form
// has two. Drop-in for <button type="submit">: every other prop passes through.

// A press that sends nothing (a required field left empty) stops showing busy after this long.
const UNSENT_MS = 400;

// The calm busy mark (founder, 2026-10-27: no "| / - \\" text spinner): a 2px line that
// slides under the label, still and faint under prefers-reduced-motion (globals.css,
// .busy-bar). Its parent needs position: relative.
export function BusyBar() {
  return (
    <span
      aria-hidden
      data-busy-bar
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
    >
      <span className="busy-bar block h-full w-2/5 bg-current" />
    </span>
  );
}

// Adds relative while busy, unless the button is already positioned (absolute, fixed, sticky
// or relative), which already holds the bar.
export function busyClassName(className: string | undefined): string {
  if (/(^|\s)(absolute|fixed|sticky|relative)(\s|$)/.test(className ?? "")) return className ?? "";
  return `${className ?? ""} relative`.trim();
}

export function SubmitButton({
  children,
  className,
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
      // relative only while busy, so the bar sits on the button's edge and nothing else changes.
      className={pressed ? busyClassName(className) : className}
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
      {pressed && <BusyBar />}
    </button>
  );
}
