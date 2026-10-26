// A bar filled to a percent (a budget used, a goal reached), labelled for screen readers.
// Server-rendered: it has no state.

const FILLS = {
  good: "bg-emerald-600",
  over: "bg-red-600",
  plain: "bg-zinc-900 dark:bg-zinc-100",
} as const;

export function ProgressBar({
  label,
  percent,
  fill = "good",
  tall = false,
}: {
  label: string;
  // 0 to 100.
  percent: number;
  fill?: keyof typeof FILLS;
  // A thicker, full-width bar, for a page whose main point it is.
  tall?: boolean;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`${tall ? "h-3 w-full" : "h-2"} overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800`}
    >
      <div className={`h-full ${FILLS[fill]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
