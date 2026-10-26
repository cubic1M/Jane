"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  choosePracticeStrategy,
  restorePracticeStrategy,
  type ChooseResult,
} from "@/app/investments/strategy-actions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { RiskLevel } from "@/config/investing";
import {
  BOARD_RANGES,
  boardInRange,
  type Board,
  type BoardRangeKey,
  type BoardRow,
} from "@/lib/investments/strategy-board";
import {
  LEAF_GLYPHS,
  LEAF_TAGS,
  branchesOf,
  leafFigure,
  type LevelTile,
} from "@/lib/investments/strategy-tree";
import { formatCents } from "@/lib/money";
import { MarchingPath } from "@/components/marching-path";

// The investments page, laid out like Home (founder: "similar to the homepage … interactive, and
// you can click through the tree graphs showcasing the different strategies and choose which one
// you like. It should be very easy for the user to use"). A hero graph: the practice portfolio's
// value, and the strategy in view against the level's plain mix (dashed). Three compact tiles.
// The strategy tree: the five risk levels as fixed tiles, the person's own open; a level's
// families as branches; each strategy a leaf with its glyph, tag and return a year. Picking a
// leaf shows it in the hero at once, and a panel beside it (a bottom sheet on a phone), joined by
// a marching dotted line, holds its idea, its evidence behind More and "Use this strategy":
// instant, with Revert. Practice money and demo advice only.

const BOX = "border border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-950";
const LINE = "border-dashed border-zinc-400 dark:border-zinc-600";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center border-2 border-zinc-950 bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-300";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center border border-zinc-500 px-3 text-sm font-semibold";
const CHIP_ON = "border-b-2 border-current";
const CHIP_OFF = "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";

const pct = (n: number) => `${(Math.round(Math.abs(n) * 1000) / 10).toFixed(1)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${pct(n)}`;
const signedCents = (c: number) => `${c >= 0 ? "+" : "−"}${formatCents(Math.abs(c))}`;

type Current = { main: string | null; crypto: string | null };
type Picked = { level: RiskLevel; key: string };
type Undo = { before: Current; sent: Promise<ChooseResult>; label: string };

function Stats({ row }: { row: Pick<BoardRow, "cagr" | "maxDrawdown" | "sortino" | "since"> }) {
  return (
    <span className="tabular-nums">
      {signed(row.cagr)} a year · worst drop {pct(row.maxDrawdown)} · Sortino{" "}
      {row.sortino.toFixed(2)} · {row.since}
    </span>
  );
}

function Tag({ row, yours }: { row: BoardRow; yours: boolean }) {
  return (
    <span className="text-[11px] font-semibold tracking-wide">
      <span aria-hidden="true">{LEAF_GLYPHS[row.status]} </span>[{LEAF_TAGS[row.status]}]
      {yours && <span className="ml-1">■ YOURS</span>}
    </span>
  );
}

// The strategy against the level's mix (dashed), from $100 at the range's start.
function Graph({
  board,
  row,
  range,
  height,
}: {
  board: Board;
  row: BoardRow;
  range: BoardRangeKey;
  height: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
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
  const view = boardInRange({ dates: board.dates, mix: board.mix, rows: [row] }, range);
  const line = view.lines[row.key];
  const all = [...view.mix, ...line].filter((v): v is number => v !== null);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(1, hi - lo);
  const pad = { left: 38, right: 6, top: 8, bottom: 20 };
  const n = view.dates.length;
  const x = (i: number) => pad.left + (i / Math.max(1, n - 1)) * (width - pad.left - pad.right);
  const y = (v: number) =>
    pad.top + (1 - (v - (lo - span * 0.05)) / (span * 1.1)) * (height - pad.top - pad.bottom);
  const path = (vs: readonly (number | null)[]) => {
    let d = "";
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null) return void (pen = false);
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const years = view.dates.flatMap((d, i) =>
    d.slice(5, 7) === "01" && i > 0 ? [{ i, label: d.slice(0, 4) }] : [],
  );
  const last = line.findLast((v) => v !== null) ?? 100;
  return (
    <div ref={box} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${row.label}: $100 became $${Math.round(last)}, against your level's mix`}
        className="block"
      >
        {[lo, hi].map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              strokeDasharray="1 4"
              className="stroke-zinc-300 dark:stroke-zinc-700"
            />
            <text
              x={pad.left - 4}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-zinc-500 text-[10px] tabular-nums"
            >
              ${Math.round(t)}
            </text>
          </g>
        ))}
        {(years.length > 0 ? years : [{ i: 0, label: view.dates[0]?.slice(0, 7) ?? "" }]).map(
          (t) => (
            <text
              key={t.i}
              x={x(t.i)}
              y={height - 5}
              textAnchor={t.i === 0 ? "start" : "middle"}
              className="fill-zinc-500 text-[10px]"
            >
              {t.label}
            </text>
          ),
        )}
        <path
          d={path(view.mix)}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          className="stroke-zinc-500 dark:stroke-zinc-400"
          data-graph-line="mix"
        />
        <path
          key={`${row.key}-${range}`}
          d={path(line)}
          pathLength={1}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="nw-line stroke-zinc-950 dark:stroke-zinc-50"
          data-graph-line={row.key}
        />
      </svg>
    </div>
  );
}

// The marching dotted line from the picked leaf to its panel (computer only).
function PanelLine({
  from,
  to,
}: {
  from: RefObject<HTMLElement | null>;
  to: RefObject<HTMLElement | null>;
}) {
  const [ends, setEnds] = useState<{ a: DOMRect; b: DOMRect } | null>(null);
  useEffect(() => {
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const a = from.current?.getBoundingClientRect();
        const b = to.current?.getBoundingClientRect();
        setEnds(a && b && b.width > 0 && a.width > 0 ? { a, b } : null);
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [from, to]);
  if (!ends) return null;
  // From the top of the leaf straight up to the bottom of the panel.
  const sx = ends.a.left + Math.min(ends.a.width / 2, 120);
  const sy = ends.a.top;
  const ex = ends.b.left + ends.b.width / 2;
  const ey = ends.b.bottom;
  // Only while both ends are on screen and the leaf is below the panel.
  if (sy < ey || sy > window.innerHeight) return null;
  const dy = Math.max(20, (sy - ey) / 2);
  return (
    <svg
      aria-hidden="true"
      data-panel-line=""
      className="pointer-events-none fixed inset-0 z-30 hidden h-full w-full overflow-visible lg:block"
    >
      <MarchingPath d={`M${sx},${sy} C${sx},${sy - dy} ${ex},${ey + dy} ${ex},${ey}`} />
    </svg>
  );
}

export function StrategyTree({
  tiles,
  board: own,
  practice,
  ideas,
}: {
  tiles: LevelTile[];
  // The person's own level's board.
  board: Board;
  practice: { totalCents: number; startingCents: number } | null;
  ideas: number;
}) {
  const yourLevel = own.level;
  const [boards, setBoards] = useState<Partial<Record<RiskLevel, Board>>>({ [yourLevel]: own });
  const [openLevel, setOpenLevel] = useState<RiskLevel | null>(yourLevel);
  const [loading, setLoading] = useState<RiskLevel | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [range, setRange] = useState<BoardRangeKey>("2020");
  const [current, setCurrent] = useState<Current>(() => ({
    main:
      own.rows.find((r) => r.current && !r.key.startsWith("crypto:"))?.key ??
      (own.followsElsewhere ? null : "default"),
    crypto: own.rows.find((r) => r.current && r.key.startsWith("crypto:"))?.key ?? null,
  }));
  const [confirming, setConfirming] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pending = useRef<Promise<ChooseResult> | null>(null);
  const leafRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const isCurrent = (level: RiskLevel, key: string) =>
    level === yourLevel && (current.main === key || current.crypto === key);

  const openTile = (level: RiskLevel) => {
    if (openLevel === level) return setOpenLevel(null);
    setOpenLevel(level);
    if (boards[level]) return;
    setLoading(level);
    fetch(`/api/investments/strategies?level=${level}`, { cache: "no-store" })
      .then((r) =>
        r.ok ? (r.json() as Promise<Board>) : Promise.reject(new Error(String(r.status))),
      )
      .then((b) => setBoards((all) => ({ ...all, [level]: b })))
      .catch(() => setStatus("That level didn't load. Try again."))
      .finally(() => setLoading((l) => (l === level ? null : l)));
  };

  const pick = (level: RiskLevel, key: string) => {
    setConfirming(null);
    setPicked((p) => (p && p.level === level && p.key === key ? null : { level, key }));
  };

  // In view in the hero: the picked leaf, else what the practice portfolio runs.
  const heroBoard = (picked && boards[picked.level]) || own;
  const heroRow =
    heroBoard.rows.find(
      (r) => r.key === (picked && boards[picked.level] ? picked.key : current.main),
    ) ?? own.rows[0];
  const pickedBoard = picked ? boards[picked.level] : undefined;
  const pickedRow = pickedBoard?.rows.find((r) => r.key === picked?.key) ?? null;

  const use = (row: BoardRow) => {
    const before = current;
    const crypto = row.key.startsWith("crypto:");
    setCurrent(crypto ? { ...current, crypto: row.key } : { ...current, main: row.key });
    setConfirming(null);
    setStatus(`Your practice portfolio now runs ${row.label}.`);
    // Not in a transition: the mark shows at once, the save goes behind.
    const sent = choosePracticeStrategy(row.key).catch((): ChooseResult => ({
      ok: false,
      error: "That didn't go through. Try again.",
    }));
    pending.current = sent;
    setUndo({ before, sent, label: row.label });
    void sent.then((result) => {
      if (pending.current !== sent || result.ok) return;
      setCurrent(before);
      setUndo(null);
      setStatus(result.error);
    });
  };

  const revert = () => {
    if (!undo) return;
    const after = current;
    setCurrent(undo.before);
    setUndo(null);
    pending.current = null;
    setStatus("Reverted.");
    type Done = { ok: boolean; error?: string };
    void undo.sent
      .then((r): Promise<Done> | Done =>
        r.ok ? restorePracticeStrategy(r.previous) : { ok: true },
      )
      .catch((): Done => ({ ok: false, error: "That didn't go through. Try again." }))
      .then((r) => {
        if (r.ok) return;
        setCurrent(after);
        setStatus(r.error ?? "That didn't go through. Try again.");
      });
  };

  const currentLabel =
    own.rows.find((r) => r.key === current.main)?.label ?? own.followsElsewhere ?? "Your mix";
  const ownTile = tiles.find((t) => t.yours);

  const panel = (row: BoardRow, level: RiskLevel, board: Board) => {
    const mine = isCurrent(level, row.key);
    return (
      <div className="flex flex-col gap-2 text-sm">
        <Tag row={row} yours={mine} />
        <p className="text-base font-semibold [overflow-wrap:anywhere]">{row.label}</p>
        <p className="text-zinc-700 dark:text-zinc-300">{row.line}</p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          <Stats row={row} />
        </p>
        {!board.yours ? (
          <p className="text-xs">
            Your level is {ownTile?.label}.{" "}
            <Link href="/investments/profile" className="underline underline-offset-2">
              Change it
            </Link>{" "}
            to run this one.
          </p>
        ) : mine ? (
          <p className="font-semibold">
            <span aria-hidden="true">■ </span>Your practice portfolio runs this
          </p>
        ) : row.use.kind === "no" ? (
          <p className="text-xs">{row.use.why}</p>
        ) : confirming === row.key && row.use.kind === "confirm" ? (
          <div className="flex flex-col gap-2" data-confirm="">
            <p className="font-semibold">
              <span aria-hidden="true">▲ </span>
              {row.use.warning}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={PRIMARY} onClick={() => use(row)}>
                Yes, use it
              </button>
              <button type="button" className={SECONDARY} onClick={() => setConfirming(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${PRIMARY} w-full`}
            onClick={() => (row.use.kind === "confirm" ? setConfirming(row.key) : use(row))}
          >
            Use this strategy
          </button>
        )}
        {undo && (
          <button type="button" className={`${SECONDARY} self-start`} onClick={revert}>
            Revert
          </button>
        )}
        <details className="text-xs text-zinc-700 dark:text-zinc-300">
          <summary className="cursor-pointer font-semibold">More</summary>
          <div className="mt-1 flex flex-col gap-1.5">
            {row.more.map((m) => (
              <p key={m}>{m}</p>
            ))}
            {row.regimes.length > 0 && (
              <p>
                Past regimes:{" "}
                {row.regimes
                  .map(
                    (g) =>
                      `${g.label} ${signed(g.strategy)}${g.mix === null ? "" : ` (your mix ${signed(g.mix)})`}`,
                  )
                  .join(", ")}
                .
              </p>
            )}
          </div>
        </details>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-strategy-tree="">
      {/* The hero: on a computer it stays in view while the tree scrolls under it. */}
      <section
        aria-label="Your practice portfolio"
        className="z-20 flex flex-col gap-2 bg-white pb-2 lg:sticky lg:top-14 dark:bg-zinc-950"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-semibold tracking-wider text-zinc-600 dark:text-zinc-400">
              PRACTICE PORTFOLIO
            </p>
            {practice ? (
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-3xl font-semibold tabular-nums">
                  {formatCents(practice.totalCents)}
                </span>
                <span className="text-sm tabular-nums">
                  {signedCents(practice.totalCents - practice.startingCents)} since you started
                </span>
              </p>
            ) : (
              <p className="text-sm">Starts with your first scan.</p>
            )}
            <p className="text-sm" data-hero-line={heroRow.key} aria-live="polite">
              <span className="font-semibold">{heroRow.label}</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {" "}
                · replay, <Stats row={heroRow} />
              </span>
            </p>
            <Graph board={heroBoard} row={heroRow} range={range} height={180} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                <span aria-hidden="true">━ </span>this strategy <span aria-hidden="true">╌ </span>
                {heroBoard.mix.label}
              </p>
              <div role="group" aria-label="Range" className="flex">
                {BOARD_RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={r.key === range}
                    onClick={() => setRange(r.key)}
                    className={`inline-flex min-h-11 items-center px-2 text-xs font-semibold ${r.key === range ? CHIP_ON : CHIP_OFF}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* The panel beside the graph (a bottom sheet on a phone, below). */}
          <div
            ref={panelRef}
            data-strategy-panel=""
            className={`hidden flex-col gap-2 border-2 border-dashed p-3 lg:flex ${pickedRow ? "border-zinc-950 dark:border-zinc-50" : "border-zinc-400 dark:border-zinc-600"}`}
          >
            {pickedRow && picked && pickedBoard ? (
              panel(pickedRow, picked.level, pickedBoard)
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Pick a strategy in the tree to see it here and use it.
              </p>
            )}
          </div>
        </div>
        <p role="status" className="min-h-5 text-sm font-semibold">
          {status}
        </p>
      </section>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="At a glance">
        <li className={`flex flex-col gap-0.5 p-3 ${BOX}`}>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Risk level</span>
          <span className="font-semibold">{ownTile?.label}</span>
          <Link href="/investments/profile" className="text-xs underline underline-offset-2">
            Change it
          </Link>
        </li>
        <li className="flex">
          <button
            type="button"
            data-tile="strategy"
            onClick={() => {
              setOpenLevel(yourLevel);
              if (current.main) setPicked({ level: yourLevel, key: current.main });
            }}
            className={`flex w-full flex-col gap-0.5 p-3 text-left hover:border-zinc-950 dark:hover:border-zinc-50 ${BOX}`}
          >
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Strategy</span>
            <span className="font-semibold [overflow-wrap:anywhere]">{currentLabel}</span>
            <span className="text-xs">See it ›</span>
          </button>
        </li>
        <li className="flex">
          <Link
            href="/investments/practice"
            className={`flex w-full flex-col gap-0.5 p-3 hover:border-zinc-950 dark:hover:border-zinc-50 ${BOX}`}
          >
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Practice ideas</span>
            <span className="font-semibold">
              {ideas === 0 ? "None waiting" : `${ideas} waiting`}
            </span>
            <span className="text-xs">Open ›</span>
          </Link>
        </li>
      </ul>

      <section aria-labelledby="strategy-tree-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 id="strategy-tree-heading" className="text-base font-semibold">
            Strategies by risk level
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Pick a level, then a strategy</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map((t) => {
            const isOpen = t.level === openLevel;
            return (
              <li key={t.level} className="flex">
                <button
                  type="button"
                  data-level-tile={t.level}
                  aria-expanded={isOpen}
                  onClick={() => openTile(t.level)}
                  className={`flex w-full flex-col items-start gap-1 p-3 text-left ${
                    isOpen
                      ? "invert-scope border-2 border-zinc-500 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : `${BOX} hover:border-zinc-950 dark:hover:border-zinc-50`
                  }`}
                >
                  <span className="flex w-full items-start gap-1">
                    <span className="min-w-0 flex-1 text-sm font-semibold">{t.label}</span>
                    <span aria-hidden="true" className="text-xs font-semibold">
                      [{isOpen ? "−" : "+"}]
                    </span>
                  </span>
                  <span className="text-xs opacity-80">{t.yours ? "Yours" : t.count || " "}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {openLevel && loading === openLevel && !boards[openLevel] && (
          <p className="text-sm">[████░░░░░░░░] loading</p>
        )}
        {openLevel && boards[openLevel] && (
          <LevelTree
            board={boards[openLevel]!}
            picked={picked}
            isCurrent={isCurrent}
            onPick={pick}
            leafRef={leafRef}
          />
        )}
        <details className="text-xs text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer">How these were tested</summary>
          <div className="mt-1 flex flex-col gap-1">
            <p>
              Each strategy is replayed on real prices after costs. Since 2020, each year uses the
              setting chosen on the years before it, so the numbers are out of sample. A haircut for
              testing so many at once keeps luck from looking like skill.
            </p>
            <p>{own.notForecast} Practice money only.</p>
            <ul className="list-disc pl-4">
              {own.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </details>
        <DemoAdviceLabel />
      </section>

      {pickedRow && (
        <PanelLine from={leafRef} to={panelRef} key={`${picked?.level}-${picked?.key}`} />
      )}

      {/* On a phone the panel is a bottom sheet with its own small graph. */}
      {pickedRow && picked && pickedBoard && (
        <div
          role="dialog"
          aria-label={pickedRow.label}
          data-strategy-sheet=""
          className="nw-sheet-in fixed inset-x-0 bottom-0 z-[70] flex max-h-[75vh] flex-col gap-2 overflow-y-auto border-t-2 border-zinc-950 bg-white p-4 shadow-2xl lg:hidden dark:border-zinc-50 dark:bg-zinc-950"
        >
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="self-end text-sm font-semibold"
            aria-label="Close"
          >
            [×]
          </button>
          <Graph board={pickedBoard} row={pickedRow} range={range} height={140} />
          {panel(pickedRow, picked.level, pickedBoard)}
        </div>
      )}
    </div>
  );
}

function LevelTree({
  board,
  picked,
  isCurrent,
  onPick,
  leafRef,
}: {
  board: Board;
  picked: Picked | null;
  isCurrent: (level: RiskLevel, key: string) => boolean;
  onPick: (level: RiskLevel, key: string) => void;
  leafRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div
      role="region"
      aria-label={`${board.levelLine.split(":")[0]}: strategies`}
      data-level-tree={board.level}
      className="giant-open flex flex-col gap-2"
    >
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{board.levelLine}</p>
      <ul className={`grid grid-cols-1 gap-x-4 gap-y-4 border-t-2 pt-4 sm:grid-cols-2 ${LINE}`}>
        {branchesOf(board).map((b) => (
          <li key={b.key} data-branch={b.key} className="flex min-w-0 flex-col">
            <p className={`flex items-baseline justify-between gap-2 p-2 ${BOX}`}>
              <span className="text-sm font-semibold">{b.label}</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{b.leaves.length}</span>
            </p>
            <ul className={`ml-3 flex flex-col border-l-2 ${LINE}`}>
              {b.leaves.map((r) => {
                const on = picked?.level === board.level && picked.key === r.key;
                const mine = isCurrent(board.level, r.key);
                return (
                  <li key={r.key} className="flex items-start pt-2">
                    <span aria-hidden="true" className={`mt-5 w-3 shrink-0 border-t-2 ${LINE}`} />
                    <button
                      type="button"
                      ref={on ? leafRef : undefined}
                      data-strategy-leaf={r.key}
                      data-status={r.status}
                      aria-pressed={on}
                      onClick={() => onPick(board.level, r.key)}
                      className={`flex min-h-11 min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-left text-sm ${
                        on
                          ? "border-2 border-zinc-950 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
                          : `${BOX} hover:border-zinc-950 dark:hover:border-zinc-50`
                      }`}
                    >
                      <span className="flex w-full items-start gap-2">
                        <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
                          {r.label}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">{leafFigure(r)}</span>
                      </span>
                      <span className="text-[11px] font-semibold tracking-wide text-zinc-600 dark:text-zinc-400">
                        <span aria-hidden="true">{LEAF_GLYPHS[r.status]} </span>[
                        {LEAF_TAGS[r.status]}]
                        {mine && (
                          <span className="ml-1 text-zinc-950 dark:text-zinc-50">■ YOURS</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
