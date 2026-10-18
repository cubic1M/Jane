import Link from "next/link";
import type { HubGroup, HubTileData } from "@/lib/hubs/tile";

// A hub tile (spec step 80): the label, one live number, a one-line status, and the page
// it opens. The whole tile is the link; a second link sits above it.
export function HubTile({ tile }: { tile: HubTileData }) {
  return (
    <li className="relative flex min-w-0 flex-col gap-1 rounded-xl border border-zinc-200 p-3 [overflow-wrap:anywhere] sm:p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
      <Link
        href={tile.href}
        className="text-sm font-medium text-emerald-700 after:absolute after:inset-0 after:rounded-xl hover:underline"
      >
        {tile.label}
      </Link>
      {tile.value !== null && (
        <p className="text-lg font-semibold tabular-nums sm:text-xl">{tile.value}</p>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{tile.status}</p>
      {tile.more && (
        <Link
          href={tile.more.href}
          className="relative z-10 self-start text-sm font-medium text-emerald-700 hover:underline"
        >
          {tile.more.label}
        </Link>
      )}
    </li>
  );
}

// Tiles in a grid: two across on a phone, three on a wider screen.
export function HubTiles({ tiles }: { tiles: HubTileData[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <HubTile key={tile.href + tile.label} tile={tile} />
      ))}
    </ul>
  );
}

// Each group under its own heading.
export function HubGroups({ groups }: { groups: HubGroup[] }) {
  return groups.map((group) => (
    <section key={group.title} className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{group.title}</h2>
      <HubTiles tiles={group.tiles} />
    </section>
  ));
}
