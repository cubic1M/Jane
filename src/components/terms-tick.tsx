"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

// One agreement for the page: ticking either box ticks both, and each form still sends its own
// consent (debugger 11-15: a student who agreed above "Try it with sample data" opened "Try it
// with your own statement" and was asked again, in a second, empty box).
let agreed = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const setAgreed = (value: boolean) => {
  agreed = value;
  listeners.forEach((listener) => listener());
};

// "I agree to the Terms and Privacy Policy", for the ways of trying Jane on the landing page, in
// that page's own colours (src/app/landing.css).
export function TermsTick() {
  const checked = useSyncExternalStore(
    subscribe,
    () => agreed,
    () => false,
  );
  return (
    <label className="flex items-start gap-2 text-sm text-[var(--landing-mid)]">
      <input
        type="checkbox"
        name="consent"
        required
        checked={checked}
        onChange={(event) => setAgreed(event.target.checked)}
        className="mt-0.5 h-5 w-5 accent-[var(--landing-hi)]"
      />
      <span>
        I agree to the{" "}
        <Link
          href="/terms"
          className="font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
        >
          Terms
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy"
          className="font-medium text-[var(--landing-hi)] underline underline-offset-2 hover:no-underline"
        >
          Privacy Policy
        </Link>
        .
      </span>
    </label>
  );
}
