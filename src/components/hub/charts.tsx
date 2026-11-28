// The hub's small charts (docs/design/home-hub.md), hand-built SVG and HTML like
// src/components/backtest-chart.tsx. One hue for one series (emerald, lighter in dark mode),
// greys for the parts that aren't the point, thin marks with a 2px gap between fills, and
// every chart says what it shows to screen readers (role="img" and its figures). Each mark's
// own figure shows on hover through its <title>.

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
