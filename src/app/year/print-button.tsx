"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 print:hidden dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      Print or save as PDF
    </button>
  );
}
