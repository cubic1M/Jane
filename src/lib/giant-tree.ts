import type { TreeStatus } from "@/components/tree/interactive-tree";
import type { AreaKey } from "@/config/areas";
import type { AreaTree } from "@/lib/area-pages/tree";
import { worst } from "@/lib/area-pages/tree";
import type { AreaMap } from "@/lib/feature-map";

// The "What Jane does" tree on Home (founder: "it's too big, I think you should not make it drag
// around freely. Instead, put the subsections fixed (without the first layer of jane, just
// remove that), and when u click on a subsection like taxes, it expands into a tree graph. The
// full names should also be there"). The six areas are fixed tiles; one opens into its tree:
// the area, its branches, and each branch's features. Pure: what each area holds.

// The areas' own trees, by area: where an area has one, its branches and items are the tree's
// (so the home tree never drifts from the page), each linking to the page open on it.
export type AreaTrees = Partial<Record<AreaKey, AreaTree>>;

// One area's branches as the giant tree shows them: its own tree's, or else what Jane looks for
// there (the feature map's).
export type GiantBranch = {
  id: string;
  label: string;
  line: string;
  forYou: boolean;
  status?: TreeStatus;
  href: string;
  items: {
    id: string;
    label: string;
    line: string;
    forYou: boolean;
    href: string;
    ask: string;
    status?: TreeStatus;
    figure?: string;
  }[];
};

const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

export function branchesOf(map: AreaMap, own: AreaTree | undefined): GiantBranch[] {
  if (own) {
    const focus = (id: string) => `${map.href}?focus=${encodeURIComponent(id)}`;
    return own.tree.branches.map((b) => ({
      id: b.id,
      label: b.label,
      line: b.line ?? things(b.items.length),
      forYou: false,
      status: b.status,
      href: focus(b.id),
      items: b.items.map((i) => ({
        id: i.id,
        label: i.label,
        line: own.summaries[i.id] ?? i.line ?? "",
        forYou: false,
        href: focus(i.id),
        ask: `What should I do about "${i.label}"${i.figure ? ` (${i.figure})` : ""}?`,
        status: i.status,
        figure: i.figure,
      })),
    }));
  }
  return map.branches.map((b) => ({
    id: b.id,
    label: b.name,
    line: b.forYou > 0 ? `${b.forYou} for you` : things(b.features.length),
    forYou: b.forYou > 0,
    href: map.href,
    items: b.features.map((f) => ({
      id: f.id,
      label: f.name,
      line: f.line,
      forYou: f.forYou,
      href: f.href,
      ask: f.ask,
    })),
  }));
}

export type GiantFeature = GiantBranch["items"][number];

export type GiantArea = {
  key: AreaKey;
  label: string;
  line: string;
  forYou: boolean;
  status?: TreeStatus;
  href: string;
  branches: GiantBranch[];
};

// The six areas, in the feature map's order, each with what its tree holds.
export function giantAreas(maps: readonly AreaMap[], areaTrees: AreaTrees = {}): GiantArea[] {
  return maps.map((map) => {
    const own = areaTrees[map.key];
    return {
      key: map.key,
      label: map.name,
      line: own ? own.tree.sub : `${things(map.features)} · ${map.forYou} for you`,
      forYou: !own && map.forYou > 0,
      status: own ? worst(own.tree.branches.map((b) => b.status)) : undefined,
      href: map.href,
      branches: branchesOf(map, own),
    };
  });
}
