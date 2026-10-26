// The hub's small charts (docs/design/home-hub.md), hand-built SVG and HTML like
// src/components/backtest-chart.tsx. One hue for one series (emerald, lighter in dark mode),
// greys for the parts that aren't the point, thin marks with a 2px gap between fills, and
// every chart says what it shows to screen readers (role="img" and its figures). Each mark's
// own figure shows on hover through its <title>.

// A run of shares as one bar: the emphasised part in the brand colour, the others in greys
// from dark to light, separated by a 2px gap.
export function StackBar({
  parts,
  emphasis,
  label,
  height = 12,
}: {
  parts: { key: string; label: string; share: number }[];
  emphasis?: string;
  label: string;
  height?: number;
}) {
  const greys = [
    "bg-zinc-500 dark:bg-zinc-400",
    "bg-zinc-400 dark:bg-zinc-500",
    "bg-zinc-300 dark:bg-zinc-600",
    "bg-zinc-200 dark:bg-zinc-700",
  ];
  let grey = 0;
  return (
    <div role="img" aria-label={label} className="flex w-full gap-0.5" style={{ height }}>
      {parts.map((p) => (
        <span
          key={p.key}
          title={p.label}
          className={`hub-grow h-full min-w-0.5 ${
            p.key === emphasis
              ? "bg-emerald-700 dark:bg-emerald-400"
              : greys[Math.min(grey++, greys.length - 1)]
          }`}
          style={{ flexGrow: p.share, flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

// A share of one thing: a filled run on a grey track.
export function Meter({ share, label }: { share: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="h-2 w-full bg-zinc-200 dark:bg-zinc-800">
      <div
        className="hub-grow h-full bg-emerald-700 dark:bg-emerald-400"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }}
      />
    </div>
  );
}
