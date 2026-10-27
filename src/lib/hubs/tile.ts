// One tile on the Money and Ahead hubs (spec step 80): a label, one live number when
// there is one, a one-line status and the page it opens. Plain data, built by the pure
// tile builders and drawn by src/components/hub-tile.tsx.

export type HubTileData = {
  label: string;
  href: string;
  // The live number ("$12,400", "3 over"); null when there's nothing to show yet.
  value: string | null;
  status: string;
  // A second page the tile also opens, like Bills next to Subscriptions.
  more?: { href: string; label: string };
};

export type HubGroup = { title: string; tiles: HubTileData[] };
