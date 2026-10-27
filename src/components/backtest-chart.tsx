"use client";

import { useEffect, useRef, useState } from "react";
import { formatWholeDollars } from "@/lib/money";

// The backtests' value paths (spec step 295): one line per risk level on one axis, from the same
// sample amount. Levels are ordered, so one hue runs light (Very low) to dark (Very high); in
// dark mode the strongest level is the lightest. Hover or tap shows the month's values.

export type ChartSeries = {
  level: number;
  label: string;
  points: { date: string; valueCents: number }[];
};

// An ordinal ramp of greys (monotone lightness; the light end clears the surface).
const STROKES: Readonly<Record<number, string>> = {
  1: "stroke-[#b2b2b2] dark:stroke-[#505050]",
  2: "stroke-[#959595] dark:stroke-[#6a6a6a]",
  3: "stroke-[#787878] dark:stroke-[#868686]",
  4: "stroke-[#5d5d5d] dark:stroke-[#a4a4a4]",
  5: "stroke-[#373737] dark:stroke-[#d0d0d0]",
};
const SWATCHES: Readonly<Record<number, string>> = {
  1: "bg-[#b2b2b2] dark:bg-[#505050]",
  2: "bg-[#959595] dark:bg-[#6a6a6a]",
  3: "bg-[#787878] dark:bg-[#868686]",
  4: "bg-[#5d5d5d] dark:bg-[#a4a4a4]",
  5: "bg-[#373737] dark:bg-[#d0d0d0]",
};

// Drawn at the container's own width, so the axis text stays readable on a phone.
const DEFAULT_WIDTH = 640;
const PAD = { left: 52, right: 8, top: 8, bottom: 24 };

const compact = (cents: number) => `$${Math.round(cents / 100_000)}k`;
const month = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function BacktestChart({ series }: { series: ChartSeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(DEFAULT_WIDTH);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const n = series[0]?.points.length ?? 0;
  if (n < 2) return null;
  const H = W < 480 ? 200 : 240;
  const values = series.flatMap((s) => s.points.map((p) => p.valueCents));
  const step = 500_000;
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.ceil(Math.max(...values) / step) * step;
  const x = (i: number) => PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  const dates = series[0].points.map((p) => p.date);
  const years = dates
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => i > 0 && d.slice(0, 4) !== dates[i - 1].slice(0, 4))
    // Every other year when narrow.
    .filter((_, k) => W >= 420 || k % 2 === 1);

  const pick = (clientX: number, rect: DOMRect) => {
    const at = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((at - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <figure className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {series.map((s) => (
          <li key={s.level} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-0.5 w-4 rounded-full ${SWATCHES[s.level]}`}
            />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="relative" ref={box}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label="Value of each risk level's model portfolio over the replay, month by month"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-zinc-500 text-[11px]"
              >
                {compact(t)}
              </text>
            </g>
          ))}
          {years.map(({ d, i }) => (
            <text
              key={d}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              className="fill-zinc-500 text-[11px]"
            >
              {d.slice(0, 4)}
            </text>
          ))}
          {series.map((s) => (
            <polyline
              key={s.level}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={STROKES[s.level]}
              points={s.points
                .map((p, i) => `${x(i).toFixed(1)},${y(p.valueCents).toFixed(1)}`)
                .join(" ")}
            />
          ))}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-zinc-400 dark:stroke-zinc-600"
              strokeWidth={1}
            />
          )}
        </svg>
        {hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            style={hover > n / 2 ? { left: "4rem" } : { right: "0.5rem" }}
          >
            <p className="font-medium">{month(dates[hover])}</p>
            <ul>
              {[...series].reverse().map((s) => (
                <li key={s.level} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                    <span
                      aria-hidden
                      className={`inline-block h-0.5 w-3 rounded-full ${SWATCHES[s.level]}`}
                    />
                    {s.label}
                  </span>
                  <span>{formatWholeDollars(s.points[hover].valueCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </figure>
  );
}
