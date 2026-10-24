import { chartText, type Health, type TileChart } from "@/lib/hub/view";

// The hub's small charts (docs/design/home-hub.md), hand-built SVG and HTML like
// src/components/backtest-chart.tsx. One hue for one series (emerald, lighter in dark mode),
// greys for the parts that aren't the point, thin marks with a 2px gap between fills, and
// every chart says what it shows to screen readers (role="img" and its figures). Each mark's
// own figure shows on hover through its <title>.

const MARK = "fill-emerald-700 dark:fill-emerald-400";
const MARK_SOFT = "fill-emerald-700/35 dark:fill-emerald-400/35";

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

// The health of an area: a shape and a word, never colour alone.
const HEALTH: Record<Health, { word: string; shape: string; className: string }> = {
  good: { word: "Good", shape: "■", className: "text-emerald-700" },
  look: { word: "Look", shape: "▲", className: "text-amber-700" },
  act: { word: "Act", shape: "◆", className: "text-red-700" },
};

export function HealthBadge({ health, why }: { health: Health | null; why: string }) {
  if (!health) {
    return <span className="text-xs text-zinc-500">{why}</span>;
  }
  const h = HEALTH[health];
  return (
    <span
      data-health={health}
      className={`inline-flex items-center gap-1 text-xs font-semibold ${h.className}`}
    >
      <span aria-hidden>{h.shape}</span>
      <span>
        {h.word}
        <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {why}</span>
      </span>
    </span>
  );
}

// A tile's tiny chart.
export function TinyChart({ chart }: { chart: TileChart }) {
  const label = chartText(chart);
  switch (chart.kind) {
    case "bars": {
      const max = Math.max(1, ...chart.values);
      const W = 120;
      const H = 36;
      const gap = 3;
      const w = (W - gap * (chart.values.length - 1)) / chart.values.length;
      const last = chart.values.length - 1;
      return (
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${W} ${H}`}
          className="h-9 w-full max-w-32"
        >
          {chart.values.map((v, i) => {
            const h = Math.max(1, (v / max) * H);
            return (
              <rect
                key={chart.labels[i] + i}
                x={i * (w + gap)}
                y={H - h}
                width={w}
                height={h}
                className={`hub-rise ${i === last ? MARK : MARK_SOFT}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <title>{`${chart.labels[i]}: $${Math.round(v / 100).toLocaleString("en-US")}`}</title>
              </rect>
            );
          })}
        </svg>
      );
    }
    case "squares": {
      const all = [
        ...Array.from({ length: chart.filled }, () => true),
        ...Array.from({ length: chart.hollow }, () => false),
      ].slice(0, 12);
      return (
        <div role="img" aria-label={label} className="flex flex-wrap gap-1">
          {all.map((filled, i) => (
            <span
              key={i}
              className={`size-3.5 ${
                filled
                  ? "bg-emerald-700 dark:bg-emerald-400"
                  : "border-2 border-solid border-amber-500 dark:border-amber-400"
              }`}
            />
          ))}
        </div>
      );
    }
    case "split":
      return (
        <StackBar
          label={label}
          height={10}
          emphasis={chart.parts[0] ? "p0" : undefined}
          parts={chart.parts.map((p, i) => ({ key: `p${i}`, label: p.label, share: p.share }))}
        />
      );
    case "meter":
      return <Meter share={chart.share} label={label} />;
    case "progress":
      return (
        <div role="img" aria-label={label} className="flex w-full flex-col gap-1">
          {chart.items.map((g) => (
            <span
              key={g.label}
              title={g.label}
              className="block h-1.5 w-full bg-zinc-200 dark:bg-zinc-800"
            >
              <span
                className={`hub-grow block h-full ${
                  g.onTrack
                    ? "bg-emerald-700 dark:bg-emerald-400"
                    : "bg-amber-500 dark:bg-amber-400"
                }`}
                style={{ width: `${Math.round(g.share * 100)}%` }}
              />
            </span>
          ))}
        </div>
      );
    case "none":
      return <div aria-hidden className="h-2 w-full bg-zinc-200 dark:bg-zinc-800" />;
  }
}
