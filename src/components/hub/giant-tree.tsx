"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AreaMap } from "@/lib/feature-map";
import {
  centerOn,
  fitCamera,
  giantEdgePath,
  giantLayoutFor,
  showsLabels,
  zoomAt,
  type AreaTrees,
  type Camera,
  type GiantNode,
} from "@/lib/giant-tree";
import { STATUS } from "@/components/tree/interactive-tree";
import { askedBefore, rememberAsked } from "@/lib/ask-jane";

// The giant "What Jane does" tree on Home (src/lib/giant-tree.ts): all of it at once on one
// canvas. Drag to pan, the wheel or a pinch to zoom, + − and [FIT]. Clicking a node centres on
// it and opens its detail; a feature's detail is an "Ask Jane" box beside it that sends its
// question straight into the side chat, a dotted line drawn from the box to the question as it
// lands (founder: "it directly sends the question to the chat on the right, connected with an
// animated dotted curve, without the user having to press send"). Keyboard and screen readers
// get a tree: Up and Down walk it, Left goes to the parent, Right to the first child, Enter or
// Space opens one.

const VIEW_H_WIDE = 600;
const VIEW_H_NARROW = 480;
// A press that moves less than this is a click, not a drag.
const DRAG_PX = 5;
// Labels of Jane, the areas and the branches never shrink below this on screen.
const MIN_LABEL_PX = 12;

type Pointer = { x: number; y: number };

export function GiantTree({ maps, areaTrees = {} }: { maps: AreaMap[]; areaTrees?: AreaTrees }) {
  const view = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 960, h: VIEW_H_WIDE });
  // One column per area on a narrow screen, two on a wide one: whichever reads better.
  const layout = useMemo(() => giantLayoutFor(maps, size, areaTrees), [maps, size, areaTrees]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  // The camera, for the layout it was set on; a new layout (the screen changed shape) starts
  // fitted again.
  const [camera, setCameraFor] = useState<{ width: number; c: Camera } | null>(null);
  const setCamera = (c: Camera) => setCameraFor({ width: layout.width, c });
  const latest = useRef<{ width: number; c: Camera } | null>(null);
  // Animated moves (a click, the buttons, the keyboard), never a drag or the wheel.
  const [gliding, setGliding] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [focused, setFocused] = useState("jane");
  const pointers = useRef(new Map<number, Pointer>());
  const press = useRef<{ x: number; y: number; moved: boolean; cam: Camera } | null>(null);
  const pinch = useRef<{ d: number; cam: Camera } | null>(null);

  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = w < 640 ? VIEW_H_NARROW : VIEW_H_WIDE;
    setSize({ w, h });
  }, []);
  useEffect(() => {
    const el = view.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      setSize((s) => (s.w === w ? s : { w, h: w < 640 ? VIEW_H_NARROW : VIEW_H_WIDE }));
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // The wheel zooms around the pointer (a listener of its own, so it can keep the page still).
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setGliding(false);
      const now = latest.current;
      if (!now) return;
      setCameraFor({
        width: now.width,
        c: zoomAt(now.c, Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top),
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const cam = camera && camera.width === layout.width ? camera.c : fitCamera(layout, size);
  useEffect(() => {
    latest.current = { width: layout.width, c: cam };
  });
  const glide = (next: Camera) => {
    setGliding(true);
    setCamera(next);
  };
  // Opened, a node sits in the top third, clear of the pop-ups and the Jane button below.
  const open = (node: GiantNode) => {
    setPicked(node.id);
    setFocused(node.id);
    glide(centerOn(node, size, cam, 0.3));
  };
  // While something is open here, the suggestion pop-ups step aside (src/app/globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (picked) root.dataset.giantPicked = "";
    else delete root.dataset.giantPicked;
    return () => {
      delete root.dataset.giantPicked;
    };
  }, [picked]);
  const zoomBy = (factor: number) => glide(zoomAt(cam, factor, size.w / 2, size.h / 2));
  const fit = () => {
    setPicked(null);
    glide(fitCamera(layout, size));
  };

  // The order the keyboard walks: the tree, depth first (the layout's own order).
  const order = layout.nodes;
  const focusOn = (id: string) => {
    setFocused(id);
    const node = byId.get(id);
    if (node) glide(centerOn(node, size, cam));
    requestAnimationFrame(() =>
      view.current?.querySelector<HTMLElement>(`[data-giant-node="${CSS.escape(id)}"]`)?.focus({
        preventScroll: true,
      }),
    );
  };
  function onKeyDown(e: React.KeyboardEvent) {
    const i = order.findIndex((n) => n.id === focused);
    const node = order[i];
    if (!node) return;
    if (e.key === "ArrowDown" && order[i + 1]) focusOn(order[i + 1].id);
    else if (e.key === "ArrowUp" && order[i - 1]) focusOn(order[i - 1].id);
    else if (e.key === "ArrowLeft" && node.parent) focusOn(node.parent);
    else if (e.key === "ArrowRight" && node.children[0]) focusOn(node.children[0]);
    else if (e.key === "Home") focusOn(order[0].id);
    else if (e.key === "End") focusOn(order[order.length - 1].id);
    else if (e.key === "Enter" || e.key === " ") open(node);
    else if (e.key === "Escape") setPicked(null);
    else return;
    e.preventDefault();
  }

  // Dragging pans; two fingers pinch. A press that doesn't move is a click on what's under it.
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      press.current = { x: e.clientX, y: e.clientY, moved: false, cam };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), cam };
      if (press.current) press.current.moved = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = view.current?.getBoundingClientRect();
    if (pinch.current && pointers.current.size === 2 && rect) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setGliding(false);
      setCamera(
        zoomAt(
          pinch.current.cam,
          d / Math.max(1, pinch.current.d),
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top,
        ),
      );
      return;
    }
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    if (!p.moved) {
      p.moved = true;
      try {
        view.current?.setPointerCapture(e.pointerId);
      } catch {
        // Capture keeps the drag going outside the canvas; it still pans without it.
      }
    }
    setGliding(false);
    setCamera({ ...p.cam, x: p.cam.x + dx, y: p.cam.y + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      const p = press.current;
      press.current = null;
      if (p && !p.moved) {
        const id = (e.target as Element)
          .closest?.("[data-giant-node]")
          ?.getAttribute("data-giant-node");
        const node = id ? byId.get(id) : null;
        if (node) open(node);
      }
    }
  };

  const node = picked ? (byId.get(picked) ?? null) : null;
  // Where a node sits on screen.
  const screen = (n: GiantNode) => ({
    x: cam.x + n.x * cam.k,
    y: cam.y + n.y * cam.k,
    w: n.w * cam.k,
    h: n.h * cam.k,
  });
  const labelScale = (n: GiantNode) => {
    const base = n.level === 4 ? 13 : n.level === 3 ? 13 : 15;
    // Grown so it stays readable when zoomed out, but never taller than its box.
    const grow = Math.max(1, MIN_LABEL_PX / (base * cam.k));
    return Math.min(grow, (n.h * 0.62) / base);
  };

  return (
    <section aria-labelledby="giant-tree-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="giant-tree-heading" className="text-base font-semibold">
          What Jane does
        </h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Drag to move · scroll or pinch to zoom · click to open
        </p>
      </div>
      <div
        ref={view}
        data-giant-tree=""
        className="giant-view relative w-full touch-none overflow-hidden border border-zinc-400 bg-zinc-50 select-none dark:border-zinc-600 dark:bg-zinc-900/40"
        style={{ height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={`absolute top-0 left-0 origin-top-left ${gliding ? "giant-glide" : ""}`}
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`,
          }}
        >
          <svg
            aria-hidden="true"
            width={layout.width}
            height={layout.height}
            className="absolute inset-0 overflow-visible"
          >
            {layout.edges.map((e) => (
              <path
                key={e.id}
                d={giantEdgePath(e)}
                fill="none"
                strokeWidth={1.5 / Math.max(0.35, cam.k)}
                strokeDasharray="2 4"
                className="stroke-zinc-500"
              />
            ))}
          </svg>
          <div role="tree" aria-label="What Jane does" onKeyDown={onKeyDown}>
            {layout.nodes.map((n) => {
              const labelled = showsLabels(n.level, cam.k);
              const isPicked = picked === n.id;
              const scale = labelScale(n);
              return (
                <div
                  key={n.id}
                  role="treeitem"
                  data-giant-node={n.id}
                  aria-level={n.level}
                  aria-expanded={n.children.length > 0 ? true : undefined}
                  aria-selected={isPicked}
                  aria-label={`${n.status ? `${STATUS[n.status].words}: ` : ""}${n.label}${n.figure ? `, ${n.figure}` : ""}${n.forYou ? ", for you" : ""}`}
                  tabIndex={n.id === focused ? 0 : -1}
                  onFocus={() => setFocused(n.id)}
                  className={`absolute flex cursor-pointer items-center gap-1.5 overflow-hidden border px-2 ${
                    n.level === 1
                      ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                      : isPicked
                        ? "border-2 border-zinc-950 bg-white dark:border-zinc-50 dark:bg-zinc-950"
                        : "border-zinc-400 bg-white hover:border-zinc-950 dark:border-zinc-600 dark:bg-zinc-950 dark:hover:border-zinc-50"
                  }`}
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                >
                  {n.status && (
                    <span
                      aria-hidden="true"
                      className={`shrink-0 ${STATUS[n.status].className}`}
                      style={{ fontSize: 11 * scale }}
                    >
                      {STATUS[n.status].shape}
                    </span>
                  )}
                  {labelled ? (
                    <span
                      aria-hidden="true"
                      className={`min-w-0 flex-1 truncate ${n.level <= 2 ? "font-semibold" : n.level === 3 ? "font-medium" : ""}`}
                      style={{
                        fontSize: (n.level === 1 || n.level === 2 ? 15 : 13) * scale,
                        lineHeight: 1.15,
                      }}
                    >
                      {n.level === 1 ? "> " : ""}
                      {n.label}
                    </span>
                  ) : (
                    // Too small to read: a bar where the label will be.
                    <span aria-hidden="true" className="h-1.5 w-2/3 bg-zinc-300 dark:bg-zinc-700" />
                  )}
                  {n.figure && labelled && (
                    <span
                      aria-hidden="true"
                      className="shrink-0 font-semibold tabular-nums"
                      style={{ fontSize: 11 * scale }}
                    >
                      {n.figure}
                    </span>
                  )}
                  {n.forYou && labelled && (
                    <span
                      aria-hidden="true"
                      className="shrink-0 font-semibold tracking-wider"
                      style={{ fontSize: 10 * scale }}
                    >
                      [YOU]
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* The camera's buttons, top right, above everything (the pop-ups keep clear). */}
        <div
          className="absolute top-2 right-2 z-10 flex gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ["+", "Zoom in", () => zoomBy(1.4)],
              ["−", "Zoom out", () => zoomBy(1 / 1.4)],
              ["FIT", "Fit the whole tree", fit],
            ] as const
          ).map(([text, label, act]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={act}
              className="inline-flex min-h-11 min-w-11 items-center justify-center border border-zinc-500 bg-white px-2 text-sm font-semibold hover:border-zinc-950 dark:bg-zinc-950 dark:hover:border-zinc-50"
            >
              [{text}]
            </button>
          ))}
        </div>

        {node?.level === 4 && node.ask && (
          <AskBox
            key={node.id}
            question={node.ask}
            at={{ x: screen(node).x + screen(node).w + 10, y: screen(node).y }}
            maxX={size.w}
          />
        )}
      </div>

      {node && (
        <div
          data-giant-detail={node.id}
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-zinc-400 p-3 text-sm dark:border-zinc-600"
        >
          <p className="font-semibold">
            {node.label}
            {node.figure && <span className="ml-2 tabular-nums">{node.figure}</span>}
            {node.forYou && <span className="ml-2 text-xs tracking-wider">[FOR YOU]</span>}
          </p>
          {node.line && (
            <p className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">{node.line}</p>
          )}
          {node.href && (
            <Link href={node.href} className="font-semibold hover:underline">
              [OPEN]
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// The "Ask Jane" box beside a feature: one click sends its question into the side chat (no
// Send to press), once per session; a dotted line runs from the box to the question as it
// lands, and goes once Jane starts answering. Asked again, it finds the earlier answer.
function AskBox({
  question,
  at,
  maxX,
}: {
  question: string;
  at: { x: number; y: number };
  maxX: number;
}) {
  const box = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"ready" | "sending" | "answering" | "done">(() =>
    askedBefore(question) ? "done" : "ready",
  );
  const [to, setTo] = useState<{ x: number; y: number } | null>(null);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);

  // Where the line starts: the box's edge nearest the chat, kept as the page moves.
  useEffect(() => {
    if (state !== "sending") return;
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
  }, [state, at.x, at.y]);

  // The side chat says where the question landed, when Jane starts and when she's done.
  useEffect(() => {
    if (state === "ready" || state === "done") return;
    const onBubble = (e: Event) => setTo((e as CustomEvent<{ x: number; y: number }>).detail);
    const onAnswering = () => setState((s) => (s === "sending" ? "answering" : s));
    const onAnswered = () => setState("done");
    window.addEventListener("jane:bubble", onBubble);
    window.addEventListener("jane:answering", onAnswering);
    window.addEventListener("jane:answered", onAnswered);
    return () => {
      window.removeEventListener("jane:bubble", onBubble);
      window.removeEventListener("jane:answering", onAnswering);
      window.removeEventListener("jane:answered", onAnswered);
    };
  }, [state]);

  const send = () => {
    if (state === "sending" || state === "answering") return;
    if (askedBefore(question)) {
      // Already asked this session: the chat scrolls to that answer instead of asking again.
      window.dispatchEvent(new CustomEvent("jane:find", { detail: question }));
      setState("done");
      return;
    }
    rememberAsked(question);
    setTo(null);
    setState("sending");
    window.dispatchEvent(new CustomEvent("jane:send", { detail: question }));
  };

  const busy = state === "sending" || state === "answering";
  const left = Math.min(at.x, Math.max(8, maxX - 248));
  return (
    <>
      <button
        ref={box}
        type="button"
        data-ask-jane=""
        onPointerDown={(e) => e.stopPropagation()}
        onClick={send}
        disabled={busy}
        aria-label={`Ask Jane: ${question}`}
        className="invert-scope absolute z-20 flex w-60 flex-col gap-1 border-2 border-zinc-500 bg-zinc-950 p-2 text-left text-sm text-white shadow-lg disabled:opacity-80 dark:bg-zinc-50 dark:text-zinc-950"
        style={{ left, top: Math.max(8, at.y) }}
      >
        <span className="text-xs font-semibold tracking-wider">
          {busy ? "[SENDING…]" : state === "done" ? "[ASKED · SEE CHAT]" : "[ASK JANE]"}
        </span>
        <span className="[overflow-wrap:anywhere]">{question}</span>
      </button>
      {(state === "sending" || state === "answering") && from && to && (
        <AskLine from={from} to={to} fading={state === "answering"} />
      )}
    </>
  );
}

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
