import type { ReactNode } from "react";
import type { HeroView } from "@/lib/hub/view";
import { SavedTile } from "./hero-tiles";

// The home hub's hero row (docs/design/home-hub.md). The areas are one set of tiles, in "What
// Jane does" (src/components/hub/giant-tree.tsx), each with its status and figure.

// The hero: the net worth chart on top, the biggest thing on Home (the founder's "graph like
// Robinhood"), then what's been saved, once there is something, and the plan's link.
export function HeroRow({
  hero,
  planItems,
  chart,
}: {
  hero: HeroView;
  planItems: number;
  chart: ReactNode;
}) {
  const { saved, plan } = hero;
  return (
    <section aria-label="Your money at a glance" className="flex flex-col gap-3">
      {chart}
      <SavedTile saved={saved} planItems={planItems} plan={plan} />
    </section>
  );
}
