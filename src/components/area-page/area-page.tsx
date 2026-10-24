"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { InteractiveTree, StatusMark, type TreeData } from "@/components/tree/interactive-tree";

// An area page (docs/design/area-pages.md): at most three "what matters now" chips, then the
// area's tree, then the detail of the one thing picked, and nothing else until something is.
// A detail is its summary (two sentences at most), its actions, and the long text behind
// "More". ?focus=<branch> opens a branch and ?focus=<branch>:<item> picks an item, so the hub's
// tree and Jane's messages can link straight to it; picking updates the address the same way.

export type AreaChip = { id: string; label: string; figure: string };

const branchOf = (id: string) => id.split(":")[0];

export function AreaPage({
  tree,
  label,
  chips,
  summaries,
  details,
  more,
  focus,
}: {
  tree: TreeData;
  // The tree's accessible name ("Insurance").
  label: string;
  chips: AreaChip[];
  summaries: Record<string, string>;
  // Each item's actions (and its own card, where it has one), rendered on the server.
  details: Record<string, ReactNode>;
  // What sits behind "More" for an item, when there is more.
  more: Record<string, ReactNode>;
  focus?: string;
}) {
  const known = (id: string | undefined) =>
    !!id && tree.branches.some((b) => b.id === id || b.items.some((i) => i.id === id));
  const start = known(focus) ? focus! : null;
  const [open, setOpen] = useState<string | null>(start ? branchOf(start) : null);
  const [picked, setPicked] = useState<string | null>(start?.includes(":") ? start : null);
  const panel = useRef<HTMLDivElement>(null);

  // The address follows what's open, so a reload or a shared link comes back to it.
  useEffect(() => {
    const url = new URL(window.location.href);
    const now = picked ?? open;
    if (now) url.searchParams.set("focus", now);
    else url.searchParams.delete("focus");
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [open, picked]);

  const branch = tree.branches.find((b) => b.id === open) ?? null;
  const item = branch?.items.find((i) => i.id === picked) ?? null;

  const pick = (id: string) => {
    setOpen(branchOf(id));
    setPicked(id);
    requestAnimationFrame(() =>
      panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {chips.length > 0 && (
        <div role="group" aria-label="What matters now" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={picked === c.id}
              onClick={() => pick(c.id)}
              className="inline-flex min-h-11 items-center gap-2 border border-red-700/40 bg-red-50 px-3 text-sm font-semibold text-red-900 hover:border-red-700 dark:bg-red-950/40 dark:text-red-100"
            >
              <StatusMark status="act" />
              {c.label}
              {c.figure && <span className="tabular-nums">{c.figure}</span>}
            </button>
          ))}
        </div>
      )}

      <InteractiveTree
        data={tree}
        label={label}
        open={open}
        picked={picked}
        onOpen={(id) => {
          setOpen(id);
          setPicked(null);
        }}
        onPick={(id) => {
          setPicked(id);
          if (id)
            requestAnimationFrame(() =>
              panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
            );
        }}
      />

      <div ref={panel} aria-live="polite">
        {branch && item ? (
          <section
            key={item.id}
            aria-label={branch.label}
            data-area-detail={item.id}
            className="map-pop flex flex-col gap-2 border border-l-4 border-emerald-700 bg-white p-4 dark:bg-zinc-950"
          >
            <p className="flex items-center gap-2 font-semibold">
              <StatusMark status={item.status} />
              <span>{item.label}</span>
              {item.figure && <span className="ml-auto tabular-nums">{item.figure}</span>}
            </p>
            {summaries[item.id] && (
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{summaries[item.id]}</p>
            )}
            {details[item.id]}
            {more[item.id] && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-emerald-700">More</summary>
                <div className="mt-2 flex flex-col gap-2">{more[item.id]}</div>
              </details>
            )}
          </section>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {branch ? "Pick one to see it here." : "Open a branch to see what's in it."}
          </p>
        )}
      </div>
    </div>
  );
}
