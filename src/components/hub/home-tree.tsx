"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InteractiveTree } from "@/components/tree/interactive-tree";
import type { HomeTree as HomeTreeData } from "@/lib/hub/tree";

// The home tree (docs/design/area-pages.md): Jane, the six areas, each area's branches. Opening
// an area shows its branches; picking one goes to that page with the branch already open. An
// area with nothing under it goes straight to its page.

export function HomeTree({ data }: { data: HomeTreeData }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const go = (id: string) => {
    const href = data.hrefs[id];
    if (href) router.push(href);
  };

  return (
    <section aria-labelledby="home-tree" className="flex flex-col gap-2">
      <h2 id="home-tree" className="font-semibold">
        Everything, as a tree
      </h2>
      <InteractiveTree
        data={data.tree}
        label="Your areas"
        open={open}
        picked={picked}
        onOpen={(id) => {
          const area = data.tree.branches.find((b) => b.id === id);
          if (area && area.items.length === 0) return go(area.id);
          setOpen(id);
          setPicked(null);
        }}
        onPick={(id) => {
          setPicked(id);
          if (id) go(id);
        }}
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {open ? "Pick one to go there." : "Open an area to see what's in it."}
      </p>
    </section>
  );
}
