import { describe, expect, it } from "vitest";
import { buildAreaTree, LABEL_MAX_WORDS, words } from "@/lib/area-pages/tree";
import type { AreaMap } from "@/lib/feature-map";
import { homeTree } from "./tree";
import type { AreaTile } from "./view";

// The home tree (docs/design/area-pages.md): Jane → the six areas → each area's branches, and
// where each branch takes you.

const tile = (over: Partial<AreaTile> & Pick<AreaTile, "key" | "label">): AreaTile => ({
  href: `/${over.key}`,
  health: "good",
  healthWhy: "",
  value: null,
  caption: "",
  chart: { kind: "none" },
  ...over,
});

const tiles: AreaTile[] = [
  tile({ key: "money", label: "Spending & bills", href: "/money", value: "$2.3k" }),
  tile({
    key: "insurance",
    label: "Insurance",
    href: "/insurance",
    health: "act",
    healthWhy: "1 gap",
    value: "2 policies",
  }),
  tile({ key: "taxes", label: "Taxes", href: "/taxes", health: "look", healthWhy: "Check it" }),
];

const insurance = buildAreaTree({
  key: "insurance",
  label: "Insurance",
  sub: ({ urgent }) => `${urgent} urgent`,
  branches: [
    {
      id: "missing",
      label: "Cover that looks missing",
      items: [{ id: "missing:life", label: "Life cover", status: "act", summary: "" }],
    },
    { id: "renewals", label: "Renewals going up", items: [] },
    {
      id: "policies",
      label: "Your policies",
      items: [{ id: "policies:p1", label: "Car", status: "good", summary: "" }],
    },
  ],
});

const maps: AreaMap[] = [
  {
    key: "money",
    name: "Spending & bills",
    href: "/money",
    features: 3,
    forYou: 1,
    branches: [
      { id: "subscriptions", name: "Subscriptions", forYou: 1, features: [] },
      { id: "fees", name: "Bank fees", forYou: 0, features: [] },
    ],
  },
];

describe("the home tree", () => {
  const { tree, hrefs } = homeTree({ tiles, areaTrees: { insurance }, maps });

  it("has Jane at the root and an area per tile, with its health and figure", () => {
    expect(tree.label).toBe("Jane");
    expect(tree.branches.map((b) => b.id)).toEqual(["money", "insurance", "taxes"]);
    const ins = tree.branches[1];
    expect(ins).toMatchObject({ status: "act", figure: "2 policies", line: "1 urgent" });
    expect(tree.sub).toBe("1 area urgent · 1 to look at");
  });

  it("takes an area's status from its own tree, so the hub and the page agree", () => {
    const calmTile = tiles.map((t) =>
      t.key === "insurance" ? { ...t, health: "look" as const } : t,
    );
    const ins = homeTree({ tiles: calmTile, areaTrees: { insurance }, maps }).tree.branches[1];
    expect(ins.status).toBe("act");
  });

  it("shows an area's own tree branches, which open that branch on its page", () => {
    const ins = tree.branches.find((b) => b.id === "insurance")!;
    // An empty branch isn't drawn on the page, so it isn't here either.
    expect(ins.items.map((i) => i.label)).toEqual([
      "Open Insurance",
      "Cover that looks missing",
      "Your policies",
    ]);
    expect(ins.items[1]).toMatchObject({ status: "act", line: "1 urgent" });
    expect(hrefs["insurance/open"]).toBe("/insurance");
    expect(hrefs["insurance/missing"]).toBe("/insurance?focus=missing");
    expect(hrefs["insurance/policies"]).toBe("/insurance?focus=policies");
  });

  it("shows what Jane looks for in an area without a tree yet, linking to its page", () => {
    const money = tree.branches.find((b) => b.id === "money")!;
    expect(money.items.map((i) => [i.label, i.line])).toEqual([
      ["Open Spending & bills", undefined],
      ["Subscriptions", "1 for you"],
      ["Bank fees", undefined],
    ]);
    expect(hrefs["money/subscriptions"]).toBe("/money");
    // No map and no tree: the area has nothing under it, and goes straight to its page.
    expect(tree.branches.find((b) => b.id === "taxes")!.items).toEqual([]);
    expect(hrefs.taxes).toBe("/taxes");
  });

  it("keeps every label within the copy budget", () => {
    for (const b of tree.branches) {
      expect(words(b.label)).toBeLessThanOrEqual(LABEL_MAX_WORDS);
      for (const i of b.items) expect(words(i.label)).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    }
  });

  it("says all good when no area needs anything", () => {
    const calm = homeTree({
      tiles: tiles.map((t) => ({ ...t, health: "good" })),
      areaTrees: {},
      maps,
    });
    expect(calm.tree.sub).toBe("All good");
  });
});
