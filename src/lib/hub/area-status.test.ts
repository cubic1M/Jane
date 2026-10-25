import { describe, expect, it } from "vitest";
import { buildAreaTree } from "@/lib/area-pages/tree";
import { areaStatus, withAreaStatus } from "./area-status";
import type { AreaTile } from "./view";

// One status per area: its own tree decides, for its tile and for Home's tree alike.

const insurance = buildAreaTree({
  key: "insurance",
  label: "Insurance",
  sub: ({ urgent, look }) => `${urgent} urgent · ${look} to look at`,
  branches: [
    {
      id: "missing",
      label: "Cover that looks missing",
      items: [{ id: "life", label: "Life cover", status: "act", summary: "None on file." }],
    },
    {
      id: "check",
      label: "Worth a check",
      items: [{ id: "car", label: "Car", status: "look", summary: "Renews soon." }],
    },
  ],
});

const tile = (key: AreaTile["key"], health: AreaTile["health"], why: string): AreaTile => ({
  key,
  label: key,
  href: `/${key}`,
  health,
  healthWhy: why,
  value: null,
  caption: "",
  chart: { kind: "none" },
});

describe("one status per area", () => {
  it("is the area tree's worst branch, with the tree's own line", () => {
    expect(areaStatus(insurance)).toEqual({ status: "act", why: insurance.tree.sub });
  });

  it("puts that on the tile, and leaves a tile without a tree as it was", () => {
    const tiles = withAreaStatus(
      [tile("insurance", "look", "3 gaps in cover"), tile("money", "good", "All good")],
      { insurance },
    );
    expect(tiles[0]).toMatchObject({ health: "act", healthWhy: insurance.tree.sub });
    expect(tiles[1]).toMatchObject({ health: "good", healthWhy: "All good" });
  });
});
