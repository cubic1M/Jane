"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cameraFor, edgePath, layoutMap } from "@/lib/feature-map-layout";

// The tree engine (docs/design/area-pages.md): a left-to-right tree of a root, its branches and
// the open branch's items, drawn on a canvas that zooms and pans onto what's open. The feature
// map ("What Jane does"), every area page and the home hub's tree draw with it; what a node
// means is the caller's.
//
// Keyboard and screen readers: a tree (role="tree", flat treeitems with their level, position
// and expanded state), one tab stop; Up and Down move, Right opens or goes in, Left closes or
// goes out, Home and End jump, Enter or Space opens a branch or picks an item.

export type TreeStatus = "good" | "look" | "act";

export type TreeLeaf = {
  id: string;
  // Six words or fewer.
  label: string;
  // One short line under the label.
  line?: string;
  // The key figure, right-aligned ("$408/yr", "2 gaps").
  figure?: string;
  status?: TreeStatus;
  // A small mark beside the label ("for you").
  badge?: string;
};

export type TreeBranch = TreeLeaf & { items: TreeLeaf[] };

export type TreeData = { key: string; label: string; sub: string; branches: TreeBranch[] };

// The status, never colour alone: a shape, and words for screen readers.
export const STATUS: Record<TreeStatus, { shape: string; words: string; className: string }> = {
  good: { shape: "○", words: "Good", className: "" },
  look: { shape: "◐", words: "Needs a look", className: "" },
  act: { shape: "●", words: "Urgent", className: "font-bold" },
};

export function StatusMark({ status }: { status?: TreeStatus }) {
  if (!status) return null;
  const s = STATUS[status];
  return (
    <span data-status={status} className={`shrink-0 text-xs ${s.className}`}>
      <span aria-hidden="true">{s.shape}</span>
      <span className="sr-only">{s.words}: </span>
    </span>
  );
}

function Badge({ text }: { text: string }) {
  return (
    <span className="shrink-0 border border-current px-1.5 py-0.5 text-[11px] font-semibold tracking-wider uppercase">
      {text}
    </span>
  );
}

type Row =
  | { kind: "root"; id: string; level: 1 }
  | { kind: "branch"; id: string; level: 2; branch: TreeBranch; index: number }
  | { kind: "leaf"; id: string; level: 3; leaf: TreeLeaf; branch: TreeBranch; index: number };

const NODE =
  "absolute flex flex-col justify-center gap-0.5 border px-3 text-left outline-offset-2 transition-colors";

export function InteractiveTree({
  data,
  label,
  open,
  picked,
  onOpen,
  onPick,
}: {
  data: TreeData;
  // The tree's accessible name.
  label: string;
  // The open branch and the picked item, which the caller keeps (deep links, chips).
  open: string | null;
  picked: string | null;
  onOpen: (branchId: string | null) => void;
  onPick: (itemId: string | null) => void;
}) {
  const [focused, setFocused] = useState<string>(picked ?? open ?? data.key);
  const [viewWidth, setViewWidth] = useState(1000);
  const view = useRef<HTMLDivElement>(null);

  // Its width before the first paint, so the tree opens already framed.
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

  const shape = useMemo(
    () => ({
      key: data.key,
      branches: data.branches.map((b) => ({ id: b.id, features: b.items })),
    }),
    [data],
  );
  const layout = useMemo(() => layoutMap(shape, open, viewWidth), [shape, open, viewWidth]);
  const camera = cameraFor(layout.focus, viewWidth);
  const at = new Map(layout.nodes.map((n) => [n.id, n]));

  // What the keyboard walks through, in order: the root, its branches, the open one's items.
  const rows: Row[] = [{ kind: "root", id: data.key, level: 1 }];
  data.branches.forEach((branch, index) => {
    rows.push({ kind: "branch", id: branch.id, level: 2, branch, index });
    if (branch.id === open) {
      branch.items.forEach((leaf, i) =>
        rows.push({ kind: "leaf", id: leaf.id, level: 3, leaf, branch, index: i }),
      );
    }
  });
  // One tab stop, on a node that is on screen.
  const tabStop = rows.some((r) => r.id === focused) ? focused : rows[0].id;

  const focusOn = (id: string) => {
    setFocused(id);
    // After this render, so an item just shown can take focus.
    requestAnimationFrame(() =>
      view.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.focus(),
    );
  };
  const toggle = (branch: TreeBranch) => {
    onOpen(open === branch.id ? null : branch.id);
    onPick(null);
  };

  function onKeyDown(event: React.KeyboardEvent) {
    const i = rows.findIndex((r) => r.id === tabStop);
    const row = rows[i];
    if (!row) return;
    switch (event.key) {
      case "ArrowDown":
        if (rows[i + 1]) focusOn(rows[i + 1].id);
        break;
      case "ArrowUp":
        if (rows[i - 1]) focusOn(rows[i - 1].id);
        break;
      case "Home":
        focusOn(rows[0].id);
        break;
      case "End":
        focusOn(rows[rows.length - 1].id);
        break;
      case "ArrowRight":
        if (row.kind === "root" && rows[1]) focusOn(rows[1].id);
        else if (row.kind === "branch") {
          if (open !== row.id) toggle(row.branch);
          else if (row.branch.items[0]) focusOn(row.branch.items[0].id);
        }
        break;
      case "ArrowLeft":
        if (row.kind === "leaf") focusOn(row.branch.id);
        else if (row.kind === "branch") {
          if (open === row.id) toggle(row.branch);
          else focusOn(data.key);
        }
        break;
      case "Enter":
      case " ":
        if (row.kind === "branch") toggle(row.branch);
        else if (row.kind === "leaf") onPick(row.leaf.id);
        else {
          onOpen(null);
          onPick(null);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // When the open branch's items fill the view (a phone, or a long branch), the branches are
  // off to the left: a way back to all of it.
  const aBranch = layout.nodes.find((n) => n.level === 2);
  const hidesRest =
    open !== null && !!aBranch && camera.x + (aBranch.x + aBranch.w / 2) * camera.scale < 0;
  // Then the view is only as tall as the items, not the whole tree.
  const frameY = hidesRest ? layout.focus.y : 0;
  const frameH = hidesRest ? layout.focus.h : layout.height;

  return (
    <div className="flex flex-col gap-1">
      {hidesRest && (
        <button
          type="button"
          onClick={() => {
            onOpen(null);
            onPick(null);
            focusOn(open);
          }}
          className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium hover:underline"
        >
          <span aria-hidden="true">‹</span> All of {data.label}
        </button>
      )}
      <div
        ref={view}
        className="map-view relative w-full overflow-hidden border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40"
        style={{ height: Math.round(frameH * camera.scale) + 32 }}
      >
        <div
          className="map-world absolute top-4 left-0 origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${camera.x}px, ${-frameY * camera.scale}px) scale(${camera.scale})`,
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
          <div role="tree" aria-label={label} onKeyDown={onKeyDown} className="absolute inset-0">
            {rows.map((row) => {
              const box = at.get(row.id);
              if (!box) return null;
              const common = {
                "data-node": row.id,
                role: "treeitem",
                "aria-level": row.level,
                tabIndex: row.id === tabStop ? 0 : -1,
                onFocus: () => setFocused(row.id),
                style: { left: box.x, top: box.y, width: box.w, height: box.h },
              };
              if (row.kind === "root") {
                return (
                  <div
                    key={row.id}
                    {...common}
                    aria-expanded={true}
                    aria-setsize={1}
                    aria-posinset={1}
                    onClick={() => {
                      onOpen(null);
                      onPick(null);
                    }}
                    className={`${NODE} cursor-pointer border-zinc-950 bg-zinc-950 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950`}
                  >
                    <span className="text-sm font-semibold">{data.label}</span>
                    <span className="text-xs opacity-90">{data.sub}</span>
                  </div>
                );
              }
              if (row.kind === "branch") {
                const isOpen = open === row.id;
                const b = row.branch;
                return (
                  <div
                    key={row.id}
                    {...common}
                    aria-expanded={isOpen}
                    aria-setsize={data.branches.length}
                    aria-posinset={row.index + 1}
                    onClick={() => {
                      setFocused(row.id);
                      toggle(b);
                    }}
                    className={`${NODE} map-pop cursor-pointer ${
                      isOpen
                        ? "border-2 border-zinc-950 bg-white dark:border-zinc-50 dark:bg-zinc-950"
                        : "border-zinc-300 bg-white hover:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <StatusMark status={b.status} />
                      <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-semibold">
                        {b.label}
                      </span>
                      {b.figure ? (
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {b.figure}
                        </span>
                      ) : (
                        <>
                          <span aria-hidden="true" className="text-xs text-zinc-500 tabular-nums">
                            {b.items.length}
                          </span>
                          <span className="sr-only">
                            , {b.items.length} {b.items.length === 1 ? "thing" : "things"}
                          </span>
                        </>
                      )}
                      <span
                        aria-hidden="true"
                        className={`transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                      >
                        ▸
                      </span>
                    </span>
                    {b.line && (
                      <span className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {b.line}
                      </span>
                    )}
                  </div>
                );
              }
              const isPicked = picked === row.id;
              const leaf = row.leaf;
              return (
                <div
                  key={row.id}
                  {...common}
                  aria-selected={isPicked}
                  aria-setsize={row.branch.items.length}
                  aria-posinset={row.index + 1}
                  onClick={() => {
                    setFocused(row.id);
                    onPick(row.id);
                  }}
                  className={`${NODE} map-pop cursor-pointer ${
                    isPicked
                      ? "border-2 border-zinc-950 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
                      : "border-zinc-300 bg-white hover:border-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-50"
                  }`}
                  style={{ ...common.style, animationDelay: `${Math.min(row.index, 12) * 25}ms` }}
                >
                  <span className="flex items-center gap-2">
                    <StatusMark status={leaf.status} />
                    <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight font-semibold">
                      {leaf.label}
                    </span>
                    {leaf.badge && <Badge text={leaf.badge} />}
                    {leaf.figure && (
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {leaf.figure}
                      </span>
                    )}
                  </span>
                  {leaf.line && (
                    <span className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {leaf.line}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export { Badge as TreeBadge };
