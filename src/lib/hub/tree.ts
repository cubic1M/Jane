import type { TreeData, TreeLeaf } from "@/components/tree/interactive-tree";
import type { AreaKey } from "@/config/areas";
import { worst, type AreaTree } from "@/lib/area-pages/tree";
import type { AreaMap } from "@/lib/feature-map";
import type { AreaTile } from "./view";

// The home tree (docs/design/area-pages.md): Jane, the six areas, and each area's branches.
// An area with its own tree page (Insurance so far) shows that tree's branches with their
// statuses, and each links to the page with the branch open (?focus=<branch>). The others show
// what Jane looks for there (the feature map's branches) and link to their page until it has
// a tree. Pure: the hub's loader gathers, this shapes.

export type HomeTree = { tree: TreeData; hrefs: Record<string, string> };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function homeTree({
  tiles,
  areaTrees,
  maps,
}: {
  tiles: AreaTile[];
  // The areas that have a tree page, by key.
  areaTrees: Partial<Record<AreaKey, AreaTree>>;
  maps: AreaMap[];
}): HomeTree {
  const hrefs: Record<string, string> = {};
  const branches = tiles.map((tile) => {
    const own = areaTrees[tile.key];
    // The area itself, for one with nothing under it, and its first item.
    hrefs[tile.key] = tile.href;
    hrefs[`${tile.key}/open`] = tile.href;
    const open: TreeLeaf = { id: `${tile.key}/open`, label: `Open ${tile.label}` };
    const under: TreeLeaf[] = own
      ? own.tree.branches.map((b) => {
          const id = `${tile.key}/${b.id}`;
          hrefs[id] = `${tile.href}?focus=${encodeURIComponent(b.id)}`;
          return { id, label: b.label, line: b.line, status: b.status };
        })
      : (maps.find((m) => m.key === tile.key)?.branches ?? []).map((b) => {
          const id = `${tile.key}/${b.id}`;
          hrefs[id] = tile.href;
          return {
            id,
            label: b.name,
            line: b.forYou > 0 ? `${b.forYou} for you` : undefined,
          };
        });
    const items = under.length > 0 ? [open, ...under] : [];
    // An area with its own tree says what its page says; the others what their tile says.
    return {
      id: tile.key,
      label: tile.label,
      status: own ? worst(own.tree.branches.map((b) => b.status)) : (tile.health ?? undefined),
      figure: tile.value ?? undefined,
      line: own ? own.tree.sub : tile.healthWhy || undefined,
      items,
    };
  });
  const urgent = branches.filter((b) => b.status === "act").length;
  const look = branches.filter((b) => b.status === "look").length;
  const sub =
    urgent + look === 0
      ? "All good"
      : [urgent > 0 && `${plural(urgent, "area")} urgent`, look > 0 && `${look} to look at`]
          .filter(Boolean)
          .join(" · ");
  return { tree: { key: "jane", label: "Jane", sub, branches }, hrefs };
}
