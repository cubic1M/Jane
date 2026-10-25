"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  usePracticeCatalog,
  usePracticeCrypto,
  usePracticeStrategy,
} from "@/app/investments/strategy-actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  BOARD_RANGES,
  STATUS_TAGS,
  boardInRange,
  type Board,
  type BoardChoice,
  type BoardRangeKey,
  type BoardRow,
} from "@/lib/investments/strategy-board";

// The investments page's strategy board (src/lib/investments/strategy-board.ts): the risk
// level picked on top, one graph of every strategy tested there (the practice portfolio's own
// line bold, the rest thin grey, the level's mix dashed), and right below it the list of them
// all. Hovering or tapping a line or a row brings it forward with its numbers; a row opens its
// evidence and, at the person's own level, the button to run it in practice. Black, white and
// grey; the bold line draws itself in (not with reduced motion).

export type LevelLink = { level: number; label: string; href: string; yours: boolean };

const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${pct(Math.abs(n))}`;
const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const BUTTON = "inline-flex min-h-9 items-center px-3 text-sm font-medium";
const PRIMARY = `${BUTTON} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`;
const SECONDARY = `${BUTTON} border border-zinc-400 dark:border-zinc-600`;

const PAD = { left: 40, right: 8, top: 10, bottom: 22 };

function Choose({ choice }: { choice: BoardChoice }) {
  const action =
    choice.action === "catalog"
      ? usePracticeCatalog
      : choice.action === "crypto"
        ? usePracticeCrypto
        : usePracticeStrategy;
  return (
    <form action={action}>
      <input
        type="hidden"
        name={choice.action === "crypto" ? "sleeve" : "strategy"}
        value={choice.value}
      />
      <button type="submit" className={choice.label === "Use in practice" ? PRIMARY : SECONDARY}>
        {choice.label}
      </button>
    </form>
  );
}

// "M x y L x y …", a new M after every gap.
function pathOf(
  values: readonly (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
) {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

function Figures({ row }: { row: Pick<BoardRow, "cagr" | "maxDrawdown" | "sortino" | "since"> }) {
  return (
    <>
      {signed(row.cagr)} a year · worst drop {pct(row.maxDrawdown)} · Sortino{" "}
      {row.sortino.toFixed(2)} · {row.since}
    </>
  );
}

export function StrategyBoard({ board, levels }: { board: Board; levels: LevelLink[] }) {
  const [range, setRange] = useState<BoardRangeKey>("2020");
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [width, setWidth] = useState(640);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (box.current) setWidth(box.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const view = useMemo(() => boardInRange(board, range), [board, range]);
  const active = hover ?? picked ?? board.highlighted;
  const activeRow = active === "mix" ? null : board.rows.find((r) => r.key === active);
  const H = width < 520 ? 210 : 270;
  const n = view.dates.length;
  const all = [...view.mix, ...Object.values(view.lines).flat()].filter(
    (v): v is number => v !== null,
  );
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  const x = (i: number) => PAD.left + (i / Math.max(1, n - 1)) * (width - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - (lo - span * 0.04)) / (span * 1.08)) * (H - PAD.top - PAD.bottom);
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
  const years = view.dates.flatMap((d, i) =>
    range !== "1y" && d.slice(5, 7) === "01" ? [{ i, label: d.slice(0, 4) }] : [],
  );
  const ends =
    range === "1y"
      ? [
          { i: 0, label: monthYear(view.dates[0]) },
          { i: n - 1, label: monthYear(view.dates[n - 1]) },
        ]
      : [];
  const others = board.rows.filter((r) => r.key !== active);
  const levelLabel = levels.find((l) => l.level === board.level)?.label ?? "";
  const tested = board.rows.length - 1;

  const pick = (key: string) => {
    setPicked(key);
    setOpen((o) => (o === key ? null : key));
  };

  return (
    <section id="strategies" aria-labelledby="strategies-heading" className="flex flex-col gap-3">
      <h2 id="strategies-heading" className="text-xl font-semibold">
        Strategies by risk level
      </h2>

      <div role="group" aria-label="Risk level" className="flex flex-wrap gap-x-1">
        {levels.map((l) => {
          const on = l.level === board.level;
          return (
            <Link
              key={l.level}
              href={l.href}
              scroll={false}
              aria-current={on ? "true" : undefined}
              className={`inline-flex min-h-11 items-center px-2 text-sm font-semibold sm:px-3 ${
                on
                  ? "border-b-2 border-current"
                  : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              {l.label}
              {l.yours && <span className="ml-1 text-xs font-normal">(yours)</span>}
            </Link>
          );
        })}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400" data-level-line="">
        {board.levelLine}{" "}
        <Link href="/investments/profile" className="underline underline-offset-2">
          Change yours
        </Link>
      </p>

      <div className="flex flex-col gap-1">
        <p aria-live="polite" className="min-h-10 text-sm" data-board-active={active}>
          <span className="font-semibold">{activeRow ? activeRow.label : board.mix.label}</span>
          <br />
          <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
            <Figures row={activeRow ?? { ...board.mix, since: board.rows[0].since }} />
          </span>
        </p>
        <div ref={box} className="w-full" onPointerLeave={() => setHover(null)}>
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            aria-label={`Growth of $100 in every strategy tested at ${levelLabel}, against your mix`}
            className="block"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  strokeWidth={1}
                  strokeDasharray="1 4"
                  className="stroke-zinc-300 dark:stroke-zinc-700"
                />
                <text
                  x={PAD.left - 4}
                  y={y(t) + 3}
                  textAnchor="end"
                  className="fill-zinc-500 text-[10px] tabular-nums"
                >
                  ${t}
                </text>
              </g>
            ))}
            {[...years, ...ends].map((t) => (
              <text
                key={`${t.i}-${t.label}`}
                x={x(t.i)}
                y={H - 6}
                textAnchor={t.i === n - 1 ? "end" : t.i === 0 ? "start" : "middle"}
                className="fill-zinc-500 text-[10px]"
              >
                {t.label}
              </text>
            ))}
            {others.map((r) => (
              <path
                key={r.key}
                d={pathOf(view.lines[r.key], x, y)}
                fill="none"
                strokeWidth={1}
                className="stroke-zinc-300 dark:stroke-zinc-700"
                data-line={r.key}
              />
            ))}
            <path
              d={pathOf(view.mix, x, y)}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              className="stroke-zinc-500 dark:stroke-zinc-400"
              data-line="mix"
            />
            {activeRow && (
              <path
                key={`${range}-${active}`}
                d={pathOf(view.lines[active], x, y)}
                pathLength={1}
                fill="none"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="nw-line stroke-zinc-950 dark:stroke-zinc-50"
                data-line={active}
                data-active=""
              />
            )}
            {/* Wide, invisible strokes to hover or tap a line by. */}
            {[...board.rows.map((r) => r.key), "mix"].map((key) => (
              <path
                key={`hit-${key}`}
                d={pathOf(key === "mix" ? view.mix : view.lines[key], x, y)}
                fill="none"
                stroke="transparent"
                strokeWidth={10}
                pointerEvents="stroke"
                className="cursor-pointer"
                onPointerEnter={(e) => e.pointerType === "mouse" && setHover(key)}
                onClick={() => (key === "mix" ? setPicked("mix") : pick(key))}
              />
            ))}
          </svg>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            <span aria-hidden="true">━ </span>
            {activeRow ? "This one" : "Your mix"} <span aria-hidden="true">╌ </span>
            your mix <span aria-hidden="true">─ </span>
            the other {tested} tested
          </p>
          <div role="group" aria-label="Range" className="flex">
            {BOARD_RANGES.map((r) => {
              const on = r.key === range;
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRange(r.key)}
                  className={`inline-flex min-h-11 items-center px-2 text-xs font-semibold sm:px-3 ${
                    on
                      ? "border-b-2 border-current"
                      : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {board.followsElsewhere && (
        <p className="text-sm">
          <span aria-hidden="true">■ </span>Your practice portfolio follows {board.followsElsewhere}
          , set in its settings.
        </p>
      )}

      <div className="flex flex-col">
        <h3 className="text-sm font-semibold" id="strategy-list-heading">
          Every strategy tested at {levelLabel} ({tested})
        </h3>
        <ol aria-labelledby="strategy-list-heading" className="flex flex-col">
          {board.rows.map((r) => {
            const isOpen = open === r.key;
            const on = active === r.key;
            return (
              <li
                key={r.key}
                data-board-row={r.key}
                data-status={r.status}
                className={`border-t border-dashed border-zinc-300 dark:border-zinc-700 ${
                  on ? "bg-zinc-100 dark:bg-zinc-900" : ""
                }`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`row-${r.key}`}
                  onClick={() => pick(r.key)}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setHover(r.key)}
                  onPointerLeave={() => setHover(null)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-1 py-2 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[11px] font-semibold tracking-wide text-zinc-600 dark:text-zinc-400">
                      [{STATUS_TAGS[r.status]}]{r.current && <span className="ml-1">■ YOURS</span>}
                    </span>
                    <span className="font-medium break-words">{r.label}</span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{r.line}</span>
                  </span>
                  <span className="text-right text-xs tabular-nums">
                    <span className="block text-sm font-semibold">{signed(r.cagr)}/yr</span>
                    <span className="block">worst {pct(r.maxDrawdown)}</span>
                    <span className="block">Sortino {r.sortino.toFixed(2)}</span>
                    {r.since !== board.rows[0].since && (
                      <span className="block text-zinc-500">{r.since}</span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div
                    id={`row-${r.key}`}
                    className="nw-box-in flex flex-col gap-1.5 px-1 pb-3 text-xs text-zinc-700 dark:text-zinc-300"
                  >
                    {r.more.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                    {r.regimes.length > 0 && (
                      <p>
                        Past regimes:{" "}
                        {r.regimes
                          .map(
                            (g) =>
                              `${g.label} ${signed(g.strategy)}${g.mix === null ? "" : ` (your mix ${signed(g.mix)})`}`,
                          )
                          .join(", ")}
                        .
                      </p>
                    )}
                    {r.current && (
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        <span aria-hidden="true">■ </span>
                        {r.key.startsWith("crypto:")
                          ? "Your practice portfolio runs this sleeve"
                          : "Your practice portfolio follows this"}
                      </p>
                    )}
                    {r.choose && <Choose choice={r.choose} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <details className="text-xs text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer">How these were tested</summary>
        <div className="mt-1 flex flex-col gap-1">
          <p>
            Each strategy is replayed on real prices after costs. Since 2020, each year uses the
            setting chosen on the years before it, so the numbers are out of sample. A haircut for
            testing so many at once keeps luck from looking like skill.
          </p>
          <p>{board.notForecast} Practice money only.</p>
          <ul className="list-disc pl-4">
            {board.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </details>
      <DemoAdviceLabel />
    </section>
  );
}
