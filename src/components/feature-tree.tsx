"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AreaKey } from "@/config/areas";
import type { AreaMap, BranchNode, FeatureNode } from "@/lib/feature-map";
import { cameraFor, edgePath, layoutMap } from "@/lib/feature-map-layout";

// "What Jane does" (docs/design/home-hub.md): each area's features as a tree you can open.
// The area sits on the left, its branches beside it; opening a branch zooms the view onto its
// features, each with one line and a "for you" mark when it has reached this person. Picking a
// feature shows its page and "Ask Jane about this" under the map.
//
// Keyboard and screen readers: a tree (role="tree", flat treeitems with their level, position
// and expanded state), one tab stop; Up and Down move, Right opens or goes in, Left closes or
// goes out, Home and End jump, Enter or Space opens a branch or picks a feature.

type Item =
  | { kind: "root"; id: string; level: 1 }
  | { kind: "branch"; id: string; level: 2; branch: BranchNode; index: number }
  | {
      kind: "feature";
      id: string;
      level: 3;
      feature: FeatureNode;
      branch: BranchNode;
      index: number;
    };

const forYouBadge = (
  <span className="shrink-0 bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
    for you
  </span>
);

export function FeatureTree({ maps, initial }: { maps: AreaMap[]; initial: AreaKey }) {
  const [area, setArea] = useState<AreaKey>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [focused, setFocused] = useState<string>(initial);
  const [picked, setPicked] = useState<string | null>(null);
  const [viewWidth, setViewWidth] = useState(1000);
  const view = useRef<HTMLDivElement>(null);
  const map = maps.find((m) => m.key === area) ?? maps[0];

  // Its width before the first paint, so the map opens already framed.
  useLayoutEffect(() => {
    if (view.current) setViewWidth(view.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = view.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([e]) => setViewWidth(Math.round(e.contentRect.width)));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const layout = useMemo(() => layoutMap(map, open, viewWidth), [map, open, viewWidth]);
  const camera = cameraFor(layout.focus, viewWidth);
  const at = new Map(layout.nodes.map((n) => [n.id, n]));

  // What the keyboard walks through, in order: the area, its branches, the open one's features.
  const items: Item[] = [{ kind: "root", id: map.key, level: 1 }];
  map.branches.forEach((branch, index) => {
    items.push({ kind: "branch", id: branch.id, level: 2, branch, index });
    if (branch.id === open) {
      branch.features.forEach((feature, i) =>
        items.push({ kind: "feature", id: feature.id, level: 3, feature, branch, index: i }),
      );
    }
  });
  // One tab stop, on an item that is on screen.
  const tabStop = items.some((it) => it.id === focused) ? focused : items[0].id;
  const pickedFeature = map.branches.flatMap((b) => b.features).find((f) => f.id === picked);

  const focusOn = (id: string) => {
    setFocused(id);
    // After this render, so a feature just shown can take focus.
    requestAnimationFrame(() =>
      view.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.focus(),
    );
  };
  const toggle = (branch: BranchNode) => {
    setOpen((o) => (o === branch.id ? null : branch.id));
    setPicked(null);
  };
  const choose = (key: AreaKey) => {
    setArea(key);
    setOpen(null);
    setPicked(null);
    setFocused(key);
  };

  function onKeyDown(event: React.KeyboardEvent) {
    const i = items.findIndex((it) => it.id === tabStop);
    const item = items[i];
    if (!item) return;
    switch (event.key) {
      case "ArrowDown":
        if (items[i + 1]) focusOn(items[i + 1].id);
        break;
      case "ArrowUp":
        if (items[i - 1]) focusOn(items[i - 1].id);
        break;
      case "Home":
        focusOn(items[0].id);
        break;
      case "End":
        focusOn(items[items.length - 1].id);
        break;
      case "ArrowRight":
        if (item.kind === "root" && items[1]) focusOn(items[1].id);
        else if (item.kind === "branch") {
          if (open !== item.id) toggle(item.branch);
          else if (item.branch.features[0]) focusOn(item.branch.features[0].id);
        }
        break;
      case "ArrowLeft":
        if (item.kind === "feature") focusOn(item.branch.id);
        else if (item.kind === "branch") {
          if (open === item.id) toggle(item.branch);
          else focusOn(map.key);
        }
        break;
      case "Enter":
      case " ":
        if (item.kind === "branch") toggle(item.branch);
        else if (item.kind === "feature") setPicked(item.feature.id);
        else {
          setOpen(null);
          setPicked(null);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const NODE =
    "absolute flex flex-col justify-center gap-0.5 border px-3 text-left outline-offset-2 transition-colors";

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Areas"
        // relative: the chips' screen-reader words are absolutely placed, and without a positioned
        // parent they sat at the far end of this scroller and widened the page on a phone.
        className="relative -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {maps.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={m.key === area}
            onClick={() => choose(m.key)}
            className={`min-h-11 shrink-0 border px-3 text-sm whitespace-nowrap ${
              m.key === area
                ? "border-emerald-700 bg-emerald-700 font-semibold text-white"
                : "border-zinc-300 hover:border-emerald-700 dark:border-zinc-700"
            }`}
          >
            {m.name}
            {m.forYou > 0 && (
              <span className="ml-1.5 text-xs">
                · {m.forYou}
                <span className="sr-only"> for you</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        ref={view}
        className="map-view relative w-full overflow-hidden border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40"
        style={{ height: Math.round(layout.height * camera.scale) + 32 }}
      >
        <div
          className="map-world absolute top-4 left-0 origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translateX(${camera.x}px) scale(${camera.scale})`,
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
                d={edgePath(e)}
                pathLength={1}
                fill="none"
                strokeWidth={1.5}
                className="map-edge stroke-zinc-400 dark:stroke-zinc-600"
              />
            ))}
          </svg>
          <div
            role="tree"
            aria-label={`What Jane does: ${map.name}`}
            onKeyDown={onKeyDown}
            className="absolute inset-0"
          >
            {items.map((item) => {
              const box = at.get(item.id);
              if (!box) return null;
              const common = {
                "data-node": item.id,
                role: "treeitem",
                "aria-level": item.level,
                tabIndex: item.id === tabStop ? 0 : -1,
                onFocus: () => setFocused(item.id),
                style: { left: box.x, top: box.y, width: box.w, height: box.h },
              };
              if (item.kind === "root") {
                return (
                  <div
                    key={item.id}
                    {...common}
                    aria-expanded={true}
                    aria-setsize={1}
                    aria-posinset={1}
                    onClick={() => {
                      setOpen(null);
                      setPicked(null);
                    }}
                    className={`${NODE} cursor-pointer border-emerald-700 bg-emerald-700 text-white`}
                  >
                    <span className="text-sm font-semibold">{map.name}</span>
                    <span className="text-xs opacity-90">
                      {map.features} things · {map.forYou} for you
                    </span>
                  </div>
                );
              }
              if (item.kind === "branch") {
                const isOpen = open === item.id;
                return (
                  <div
                    key={item.id}
                    {...common}
                    aria-expanded={isOpen}
                    aria-setsize={map.branches.length}
                    aria-posinset={item.index + 1}
                    onClick={() => {
                      setFocused(item.id);
                      toggle(item.branch);
                    }}
                    className={`${NODE} map-pop cursor-pointer ${
                      isOpen
                        ? "border-emerald-700 bg-white dark:bg-zinc-950"
                        : "border-zinc-300 bg-white hover:border-emerald-700 dark:border-zinc-700 dark:bg-zinc-950"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {item.branch.name}
                      </span>
                      <span aria-hidden="true" className="text-xs text-zinc-500 tabular-nums">
                        {item.branch.features.length}
                      </span>
                      <span className="sr-only">, {item.branch.features.length} things</span>
                      <span
                        aria-hidden="true"
                        className={`text-emerald-700 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                      >
                        ▸
                      </span>
                    </span>
                    {item.branch.forYou > 0 && (
                      <span className="text-xs text-amber-800 dark:text-amber-300">
                        {item.branch.forYou} for you
                      </span>
                    )}
                  </div>
                );
              }
              const isPicked = picked === item.id;
              return (
                <div
                  key={item.id}
                  {...common}
                  aria-selected={isPicked}
                  aria-setsize={item.branch.features.length}
                  aria-posinset={item.index + 1}
                  onClick={() => {
                    setFocused(item.id);
                    setPicked(item.id);
                  }}
                  className={`${NODE} map-pop cursor-pointer ${
                    isPicked
                      ? "border-emerald-700 bg-emerald-50 dark:bg-emerald-950"
                      : "border-zinc-300 bg-white hover:border-emerald-700 dark:border-zinc-700 dark:bg-zinc-950"
                  }`}
                  style={{ ...common.style, animationDelay: `${Math.min(item.index, 12) * 25}ms` }}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {item.feature.name}
                    </span>
                    {item.feature.forYou && forYouBadge}
                  </span>
                  <span className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {item.feature.line}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div aria-live="polite" className="min-h-14">
        {pickedFeature ? (
          <div className="map-pop flex flex-col gap-2 border border-l-4 border-emerald-700 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold">
                {pickedFeature.name}
                {pickedFeature.forYou && forYouBadge}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{pickedFeature.line}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("jane:ask", { detail: pickedFeature.ask }))
                }
                className="inline-flex min-h-11 items-center bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Ask Jane about this
              </button>
              <Link
                href={pickedFeature.href}
                className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-emerald-700 hover:underline"
              >
                Open the page ›
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Open a branch, then pick a feature to see its page or ask Jane about it.
          </p>
        )}
      </div>
    </div>
  );
}
