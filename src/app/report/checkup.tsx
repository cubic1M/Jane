import type { CheckLine, CheckStatus } from "@/detection/checkup";

// The checkup (docs/design/area-pages.md: few words, detail on click): one line per check Jane
// ran, with its number; a tap says what it looked at.

const MARK: Record<CheckStatus, { sign: string; label: string; className: string }> = {
  found: {
    sign: "!",
    label: "Found",
    // Black and white only (docs/design/area-pages.md): found is the filled mark.
    className: "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900",
  },
  passed: {
    sign: "✓",
    label: "Passed",
    className: "border border-zinc-900 text-zinc-900 dark:border-white dark:text-white",
  },
  not_enough_data: {
    sign: "–",
    label: "Not enough data",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  },
};

export function checkupSummary(lines: readonly CheckLine[]): string {
  const passed = lines.filter((l) => l.status === "passed").length;
  return `${passed} of ${lines.length} checks passed`;
}

export function Checkup({ lines }: { lines: readonly CheckLine[] }) {
  if (lines.length === 0) return null;
  return (
    <section data-checkup="" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">Checkup</h2>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{checkupSummary(lines)}</span>
      </div>
      <ul
        aria-label="Checkup"
        className="flex flex-col divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
      >
        {lines.map((line) => {
          const mark = MARK[line.status];
          return (
            <li key={line.type} data-check={line.status}>
              <details>
                <summary className="flex cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${mark.className}`}
                  >
                    {mark.sign}
                  </span>
                  <span className="sr-only">{mark.label}:</span>
                  <span className="min-w-0 font-medium">{line.label}</span>
                  <span className="ml-auto min-w-0 text-right text-sm text-zinc-600 dark:text-zinc-400">
                    {line.line}
                  </span>
                </summary>
                <p className="pb-3 pl-8 text-sm text-zinc-600 dark:text-zinc-400">{line.detail}</p>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
