"use client";

// The big figures on Home start hidden (founder 11-04: people don't like to show their net worth in
// public), each with its own way to show it right beside it. Never remembered: every visit starts
// hidden. It hides them from someone looking at the screen; the browser still holds the numbers.

// What stands in for a figure: read out as "Hidden", not as five asterisks.
export function Blinded() {
  return (
    <>
      <span aria-hidden="true">*****</span>
      <span className="sr-only">Hidden</span>
    </>
  );
}

export function ShowValue({
  shown,
  what,
  onToggle,
}: {
  shown: boolean;
  // Said to a screen reader: "[SHOW VALUE] of net worth".
  what: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={shown}
      data-show-value=""
      onClick={onToggle}
      className="relative z-10 inline-flex min-h-11 items-center text-xs font-semibold tracking-wider hover:underline"
    >
      {shown ? "[HIDE VALUE]" : "[SHOW VALUE]"}
      <span className="sr-only"> of {what}</span>
    </button>
  );
}
