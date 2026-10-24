"use client";

import Link from "next/link";
import { useState } from "react";
import type { AreaKey } from "@/config/areas";
import type { AreaMap } from "@/lib/feature-map";
import { InteractiveTree, TreeBadge, type TreeData } from "@/components/tree/interactive-tree";

// "What Jane does" (docs/design/home-hub.md): each area's features as a tree you can open.
// The area sits on the left, its branches beside it; opening a branch zooms the view onto its
// features, each with one line and a "for you" mark when it has reached this person. Picking a
// feature shows its page and "Ask Jane about this" under the map. Drawn with the tree engine
// (src/components/tree/interactive-tree.tsx), as the area pages are.

// One area's features as the engine's tree.
export function featureTreeData(map: AreaMap): TreeData {
  return {
    key: map.key,
    label: map.name,
    sub: `${map.features} things · ${map.forYou} for you`,
    branches: map.branches.map((b) => ({
      id: b.id,
      label: b.name,
      line: b.forYou > 0 ? `${b.forYou} for you` : undefined,
      items: b.features.map((f) => ({
        id: f.id,
        label: f.name,
        line: f.line,
        badge: f.forYou ? "for you" : undefined,
      })),
    })),
  };
}

export function FeatureTree({ maps, initial }: { maps: AreaMap[]; initial: AreaKey }) {
  const [area, setArea] = useState<AreaKey>(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const map = maps.find((m) => m.key === area) ?? maps[0];
  const pickedFeature = map.branches.flatMap((b) => b.features).find((f) => f.id === picked);

  const choose = (key: AreaKey) => {
    setArea(key);
    setOpen(null);
    setPicked(null);
  };

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

      <InteractiveTree
        key={map.key}
        data={featureTreeData(map)}
        label={`What Jane does: ${map.name}`}
        open={open}
        picked={picked}
        onOpen={setOpen}
        onPick={setPicked}
      />

      <div aria-live="polite" className="min-h-14">
        {pickedFeature ? (
          <div className="map-pop flex flex-col gap-2 border border-l-4 border-emerald-700 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold">
                {pickedFeature.name}
                {pickedFeature.forYou && <TreeBadge text="for you" />}
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
