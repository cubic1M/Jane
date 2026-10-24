import { describe, expect, it } from "vitest";
import type { AreaMap } from "@/lib/feature-map";
import { buildAreaTree } from "@/lib/area-pages/tree";
import {
  GIANT,
  centerOn,
  fitCamera,
  giantEdgePath,
  giantLayout,
  giantLayoutFor,
  showsLabels,
  zoomAt,
} from "./giant-tree";

// The giant "What Jane does" tree: Jane, the areas, their branches and features, in one world.

const feature = (id: string, forYou = false) => ({
  id,
  name: id,
  line: `About ${id}`,
  forYou,
  href: `/${id}`,
  ask: `Tell me about ${id}`,
});

const maps: AreaMap[] = [
  {
    key: "money",
    name: "Spending & bills",
    href: "/money",
    features: 3,
    forYou: 1,
    branches: [
      {
        id: "subs",
        name: "Subscriptions",
        forYou: 1,
        features: [feature("a", true), feature("b")],
      },
      { id: "fees", name: "Bank fees", forYou: 0, features: [feature("c")] },
    ],
  },
  {
    key: "insurance",
    name: "Insurance",
    href: "/insurance",
    features: 1,
    forYou: 0,
    branches: [{ id: "gaps", name: "Gaps", forYou: 0, features: [feature("d")] }],
  },
];

describe("the giant tree's layout", () => {
  const layout = giantLayout(maps);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  it("has Jane on top, the areas in a row, then branches and features", () => {
    expect(layout.nodes.map((n) => [n.id, n.level])).toEqual([
      ["jane", 1],
      ["money", 2],
      ["money/subs", 3],
      ["money/subs/a", 4],
      ["money/subs/b", 4],
      ["money/fees", 3],
      ["money/fees/c", 4],
      ["insurance", 2],
      ["insurance/gaps", 3],
      ["insurance/gaps/d", 4],
    ]);
    const jane = byId.get("jane")!;
    const money = byId.get("money")!;
    const insurance = byId.get("insurance")!;
    expect(money.y).toBe(insurance.y);
    expect(money.y).toBeGreaterThan(jane.y + jane.h);
    expect(insurance.x).toBe(money.x + GIANT.area.w + GIANT.columnGap);
    // Jane is centred over the row.
    expect(jane.x + jane.w / 2).toBe(layout.width / 2);
  });

  it("lists each branch's features under it, in order, never overlapping", () => {
    const column = layout.nodes.filter((n) => n.id.startsWith("money/"));
    for (let i = 1; i < column.length; i++) {
      expect(column[i].y).toBeGreaterThanOrEqual(column[i - 1].y + column[i - 1].h);
    }
    expect(byId.get("money/subs")!.children).toEqual(["money/subs/a", "money/subs/b"]);
    expect(byId.get("money/subs/a")).toMatchObject({
      parent: "money/subs",
      forYou: true,
      ask: "Tell me about a",
      href: "/a",
    });
  });

  it("joins every node but Jane to its parent", () => {
    expect(layout.edges).toHaveLength(layout.nodes.length - 1);
    const down = layout.edges.find((e) => e.id === "jane>money")!;
    expect(giantEdgePath(down)).toMatch(/^M[\d.]+,[\d.]+ C/);
    const side = layout.edges.find((e) => e.id === "money/subs>money/subs/a")!;
    expect(giantEdgePath(side)).toMatch(/^M[\d.]+,[\d.]+ V[\d.]+ H[\d.]+$/);
  });
});

describe("an area with its own tree", () => {
  const insurance = buildAreaTree({
    key: "insurance",
    label: "Insurance",
    sub: ({ urgent }) => `${urgent} urgent`,
    branches: [
      {
        id: "missing",
        label: "Cover that looks missing",
        items: [
          {
            id: "missing:life",
            label: "Life cover",
            status: "act",
            figure: "Missing",
            summary: "No life cover on file.",
          },
        ],
      },
    ],
  });
  const layout = giantLayout(maps, 1, { insurance });
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  it("shows that tree's branches and items, never drifting from the page", () => {
    expect(byId.get("insurance")).toMatchObject({ status: "act", line: "1 urgent" });
    expect(byId.get("insurance/missing")).toMatchObject({
      label: "Cover that looks missing",
      status: "act",
      href: "/insurance?focus=missing",
    });
    expect(byId.get("insurance/missing/missing:life")).toMatchObject({
      level: 4,
      label: "Life cover",
      figure: "Missing",
      status: "act",
      line: "No life cover on file.",
      href: "/insurance?focus=missing%3Alife",
      ask: 'What should I do about "Life cover" (Missing)?',
    });
    // The feature map's branches are gone for that area; the others keep theirs.
    expect(byId.has("insurance/gaps")).toBe(false);
    expect(byId.has("money/subs")).toBe(true);
  });
});

describe("two columns per area on a wide screen", () => {
  const big: AreaMap[] = maps.map((m) => ({
    ...m,
    branches: Array.from({ length: 6 }, (_, i) => ({
      id: `b${i}`,
      name: `Branch ${i}`,
      forYou: 0,
      features: [feature(`${m.key}${i}a`), feature(`${m.key}${i}b`)],
    })),
  }));

  it("shares an area's branches between two columns, about half each, half as tall", () => {
    const one = giantLayout(big, 1);
    const two = giantLayout(big, 2);
    expect(two.width).toBeGreaterThan(one.width * 1.8);
    expect(two.height).toBeLessThan(one.height * 0.6);
    const xs = new Set(
      two.nodes.filter((n) => n.level === 3 && n.parent === "money").map((n) => n.x),
    );
    expect(xs.size).toBe(2);
    // The area spans both.
    const area = two.nodes.find((n) => n.id === "money")!;
    expect(area.w).toBe(GIANT.area.w * 2 + GIANT.subColumnGap);
  });

  it("picks the one that fits the view at the larger scale", () => {
    expect(giantLayoutFor(big, { w: 1400, h: 600 }).width).toBe(giantLayout(big, 2).width);
    expect(giantLayoutFor(big, { w: 343, h: 480 }).width).toBe(giantLayout(big, 1).width);
  });
});

describe("the camera", () => {
  const world = { width: 1000, height: 2000 };

  it("fits the whole tree in view, centred, never larger than full size", () => {
    const cam = fitCamera(world, { w: 532, h: 1032 });
    expect(cam.k).toBeCloseTo(0.5);
    expect(cam.x).toBeCloseTo(16);
    expect(fitCamera({ width: 100, height: 100 }, { w: 1000, h: 1000 }).k).toBe(1);
  });

  it("zooms around the point under the pointer, within its limits", () => {
    const cam = zoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 50);
    expect(cam).toEqual({ k: 2, x: -100, y: -50 });
    expect(zoomAt({ k: 1, x: 0, y: 0 }, 100, 0, 0).k).toBe(GIANT.maxScale);
    expect(zoomAt({ k: 0.1, x: 0, y: 0 }, 0.01, 0, 0).k).toBe(GIANT.minScale);
  });

  it("centres on a node, close enough to read a feature", () => {
    const node = { x: 400, y: 900, w: 200, h: 30, level: 4 as const };
    const cam = centerOn(node, { w: 800, h: 600 }, { k: 0.2, x: 0, y: 0 });
    expect(cam.k).toBeCloseTo(GIANT.featureLabelPx / GIANT.feature.h);
    expect(cam.x + (node.x + node.w / 2) * cam.k).toBeCloseTo(400);
    expect(cam.y + (node.y + node.h / 2) * cam.k).toBeCloseTo(300);
  });

  it("shows feature labels only once they're big enough to read", () => {
    expect(showsLabels(2, 0.1)).toBe(true);
    expect(showsLabels(4, 0.3)).toBe(false);
    expect(showsLabels(4, 0.8)).toBe(true);
  });
});
