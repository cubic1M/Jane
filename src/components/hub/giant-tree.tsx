"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { AreaMap } from "@/lib/feature-map";
import { giantAreas, type AreaTrees, type GiantArea, type GiantFeature } from "@/lib/giant-tree";
import { STATUS, type TreeStatus } from "@/components/tree/interactive-tree";
import { askedBefore, rememberAsked } from "@/lib/ask-jane";

// The "What Jane does" tree on Home (src/lib/giant-tree.ts). The six areas are fixed tiles, a
// row of six on a computer and two by three on a phone: nothing to drag, pan or zoom, and no
// "Jane" box above them. A tile opens its area's tree below the row: the area, its branches
// side by side (as many columns as fit), and each branch's features under it, every name in
// full, wrapping rather than cut. A feature opens in place: what it is, [OPEN], and an "Ask
// Jane" box that sends its question straight into the side chat, a dotted line drawn from the
// box to the question as it lands (founder: "it directly sends the question to the chat on the
// right, connected with an animated dotted curve, without the user having to press send").

function Status({ status }: { status?: TreeStatus }) {
  if (!status) return null;
  return (
    <span className={`shrink-0 ${STATUS[status].className}`}>
      <span aria-hidden="true">{STATUS[status].shape}</span>
      <span className="sr-only">{STATUS[status].words}: </span>
    </span>
  );
}

const BOX = "border border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-950";
// The tree's lines: dotted, as the rest of the app draws them.
const LINE = "border-dashed border-zinc-400 dark:border-zinc-600";

export function GiantTree({ maps, areaTrees = {} }: { maps: AreaMap[]; areaTrees?: AreaTrees }) {
  const areas = giantAreas(maps, areaTrees);
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [openFeature, setOpenFeature] = useState<string | null>(null);
  const panelId = useId();
  const area = areas.find((a) => a.key === openArea) ?? null;

  // While a feature is open, the suggestion pop-ups step aside (src/app/globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (openFeature) root.dataset.giantPicked = "";
    else delete root.dataset.giantPicked;
    return () => {
      delete root.dataset.giantPicked;
    };
  }, [openFeature]);

  return (
    <section
      aria-labelledby="giant-tree-heading"
      data-giant-tree=""
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="giant-tree-heading" className="text-base font-semibold">
          What Jane does
        </h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Pick an area to open its tree</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {areas.map((a) => {
          const isOpen = a.key === openArea;
          return (
            <li key={a.key} className="flex">
              <button
                type="button"
                data-giant-area-tile={a.key}
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                onClick={() => {
                  setOpenFeature(null);
                  setOpenArea(isOpen ? null : a.key);
                }}
                className={`flex w-full flex-col items-start gap-1 p-3 text-left ${
                  isOpen
                    ? "invert-scope border-2 border-zinc-500 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : `${BOX} hover:border-zinc-950 dark:hover:border-zinc-50`
                }`}
              >
                <span className="flex w-full items-start gap-1.5">
                  <Status status={a.status} />
                  <span className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">
                    {a.label}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-xs font-semibold">
                    [{isOpen ? "−" : "+"}]
                  </span>
                </span>
                <span className="text-xs [overflow-wrap:anywhere] opacity-80">{a.line}</span>
                {a.forYou && <span className="sr-only">, for you</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {area && (
        <AreaTree
          id={panelId}
          area={area}
          openFeature={openFeature}
          onFeature={(id) => setOpenFeature((now) => (now === id ? null : id))}
        />
      )}
    </section>
  );
}

// One area's tree under the tiles: straight into its branches (the tile names the area), and
// each branch's features below it on a dotted line, as a tree is drawn in a terminal (└─).
function AreaTree({
  id,
  area,
  openFeature,
  onFeature,
}: {
  id: string;
  area: GiantArea;
  openFeature: string | null;
  onFeature: (id: string) => void;
}) {
  return (
    <div
      id={id}
      role="region"
      aria-label={`${area.label}: what Jane does`}
      data-giant-area={area.key}
      className="giant-open flex flex-col"
    >
      {/* Straight down into the branches (founder: no "extra 1st layer repeating the same
          name"; the tile above already says it). */}
      <ul
        className={`grid grid-cols-1 gap-x-4 gap-y-4 border-t-2 pt-4 sm:grid-cols-2 xl:grid-cols-3 ${LINE}`}
      >
        {area.branches.map((b) => (
          <li key={b.id} data-giant-branch={b.id} className="flex min-w-0 flex-col">
            <Link
              href={b.href}
              className={`flex items-start gap-1.5 p-2 hover:border-zinc-950 dark:hover:border-zinc-50 ${BOX}`}
            >
              <Status status={b.status} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold [overflow-wrap:anywhere]">
                  {b.label}
                </span>
                <span className="block text-xs text-zinc-600 dark:text-zinc-400">{b.line}</span>
              </span>
            </Link>
            <ul className={`ml-3 flex flex-col border-l-2 ${LINE}`}>
              {b.items.map((f) => {
                const fid = `${area.key}/${b.id}/${f.id}`;
                return (
                  <Feature
                    key={f.id}
                    id={fid}
                    feature={f}
                    open={openFeature === fid}
                    onToggle={() => onFeature(fid)}
                  />
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <Link href={area.href} className="mt-3 self-end text-sm font-semibold hover:underline">
        [OPEN THE PAGE ›]
      </Link>
    </div>
  );
}

function Feature({
  id,
  feature,
  open,
  onToggle,
}: {
  id: string;
  feature: GiantFeature;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li data-giant-feature={id} className="flex flex-col pt-2">
      <div className="flex items-start">
        <span aria-hidden="true" className={`mt-4 w-3 shrink-0 border-t-2 ${LINE}`} />
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`flex min-h-11 min-w-0 flex-1 items-start gap-1.5 px-2 py-1.5 text-left text-sm ${
            open
              ? "border-2 border-zinc-950 bg-white dark:border-zinc-50 dark:bg-zinc-950"
              : `${BOX} hover:border-zinc-950 dark:hover:border-zinc-50`
          }`}
        >
          <Status status={feature.status} />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{feature.label}</span>
          {feature.figure && (
            <span className="shrink-0 font-semibold tabular-nums">
              <span className="sr-only">, </span>
              {feature.figure}
            </span>
          )}
          {feature.forYou && (
            <span className="shrink-0 text-[10px] font-semibold tracking-wider">
              <span aria-hidden="true">[YOU]</span>
              <span className="sr-only">, for you</span>
            </span>
          )}
        </button>
      </div>
      {open && (
        <div data-giant-detail={id} className="ml-3 flex flex-col gap-2 pt-2 pl-2 text-sm">
          {feature.line && <p className="text-zinc-700 dark:text-zinc-300">{feature.line}</p>}
          {feature.href && (
            <Link href={feature.href} className="self-start font-semibold hover:underline">
              [OPEN]
            </Link>
          )}
          {feature.ask && <AskBox key={id} question={feature.ask} />}
        </div>
      )}
    </li>
  );
}

// The "Ask Jane" box under an open feature: one click sends its question into the side chat (no
// Send to press), once per session; a dotted line runs from the box to the question as it
// lands, and goes once Jane starts answering. Asked again, it finds the earlier answer, marks it
// and draws the line to it.
function AskBox({ question }: { question: string }) {
  const box = useRef<HTMLButtonElement>(null);
  // Asked already, it stays a button (founder: "when you asked already, u can no longer press
  // the same button"): pressed again it finds the earlier answer in the chat, with its line.
  const [state, setState] = useState<"ready" | "sending" | "answering" | "done" | "finding">(() =>
    askedBefore(question) ? "done" : "ready",
  );
  const [to, setTo] = useState<{ x: number; y: number } | null>(null);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  const drawing = state === "sending" || state === "answering" || state === "finding";
  // When the line went up: a quick answer still leaves it long enough to be seen.
  const started = useRef(0);

  // Where the line starts: the box's edge nearest the chat, kept as the page moves.
  useEffect(() => {
    if (!drawing) return;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (r) setFrom({ x: r.right, y: r.top + r.height / 2 });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [drawing]);

  // The side chat says where the question is (every frame while it moves), when Jane starts
  // and when she's done.
  useEffect(() => {
    if (!drawing) return;
    const onBubble = (e: Event) => setTo((e as CustomEvent<{ x: number; y: number }>).detail);
    const onAnswering = () => setState((s) => (s === "sending" ? "answering" : s));
    const onAnswered = () => {
      const left = Math.max(0, LINE_MIN_MS - (performance.now() - started.current));
      window.setTimeout(() => setState((s) => (s === "finding" ? s : "done")), left);
    };
    window.addEventListener("jane:bubble", onBubble);
    window.addEventListener("jane:answering", onAnswering);
    window.addEventListener("jane:answered", onAnswered);
    return () => {
      window.removeEventListener("jane:bubble", onBubble);
      window.removeEventListener("jane:answering", onAnswering);
      window.removeEventListener("jane:answered", onAnswered);
    };
  }, [drawing]);

  // Found: the line shows the way for a moment, then the box is back to "asked".
  useEffect(() => {
    if (state !== "finding") return;
    const timer = window.setTimeout(() => setState("done"), FIND_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const send = () => {
    if (state === "sending" || state === "answering") return;
    setTo(null);
    if (askedBefore(question)) {
      // Asked already: the chat scrolls to that answer and marks it; nothing is asked again.
      setState("finding");
      window.dispatchEvent(new CustomEvent("jane:find", { detail: question }));
      return;
    }
    rememberAsked(question);
    started.current = performance.now();
    setState("sending");
    window.dispatchEvent(new CustomEvent("jane:send", { detail: question }));
  };

  const busy = state === "sending" || state === "answering";
  return (
    <>
      <button
        ref={box}
        type="button"
        data-ask-jane=""
        data-ask-state={state}
        onClick={send}
        disabled={busy}
        className="invert-scope flex w-full max-w-sm flex-col gap-1 border-2 border-zinc-500 bg-zinc-950 p-2 text-left text-sm text-white shadow-lg disabled:opacity-80 dark:bg-zinc-50 dark:text-zinc-950"
      >
        <span className="text-xs font-semibold tracking-wider">
          <span aria-hidden="true">[</span>
          {busy
            ? "SENDING…"
            : state === "finding"
              ? "FINDING IT…"
              : state === "done"
                ? "ASKED ✓ · TAP TO SEE"
                : "ASK JANE"}
          <span aria-hidden="true">]</span>
          <span className="sr-only">: </span>
        </span>
        <span className="[overflow-wrap:anywhere]">{question}</span>
      </button>
      {drawing && from && to && <AskLine from={from} to={to} fading={state === "answering"} />}
    </>
  );
}

// How long the line to an earlier answer stays, and the least time the line to a new question
// is up (a quick answer would otherwise take it away before it's seen).
const FIND_LINE_MS = 1_800;
const LINE_MIN_MS = 1_500;

// The dotted curve from the box to the question in the chat, drawn over the page.
function AskLine({
  from,
  to,
  fading,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  // Jane has started answering: the line fades out.
  fading: boolean;
}) {
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2);
  return (
    <svg
      aria-hidden="true"
      data-ask-line=""
      className={`pointer-events-none fixed inset-0 z-[60] h-full w-full overflow-visible transition-opacity duration-500 motion-reduce:transition-none ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <path
        d={`M${from.x},${from.y} C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`}
        fill="none"
        strokeWidth={2}
        strokeDasharray="3 6"
        className="ask-line stroke-current"
      />
    </svg>
  );
}
