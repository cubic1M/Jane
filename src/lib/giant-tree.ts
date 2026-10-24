import type { AreaMap } from "@/lib/feature-map";

// The giant "What Jane does" tree on Home (founder: "one giant tree graph, not like u have to
// click through each subtab to see it, with the main box being jane, and the next layer being
// the subsections, and then more specification"). Jane on top, the six areas in a row under
// her, and under each area its branches, each with its features listed below it. All of it is
// one world the canvas pans and zooms over; feature labels appear as it zooms in (semantic
// zoom). Pure: the layout, and the camera's arithmetic.

export type GiantLevel = 1 | 2 | 3 | 4;

export type GiantNode = {
  id: string;
  level: GiantLevel;
  label: string;
  // One line under the label, in the detail.
  line?: string;
  forYou?: boolean;
  // Where "Open the page" goes, and where an area or branch navigates.
  href?: string;
  // A feature's question for Jane.
  ask?: string;
  parent: string | null;
  children: string[];
  // Its box in the world, in px at full size.
  x: number;
  y: number;
  w: number;
  h: number;
};

export type GiantEdge = {
  id: string;
  // Root to area runs down; within an area's column, down and in.
  way: "down" | "side";
  from: { x: number; y: number };
  to: { x: number; y: number };
};

export type GiantLayout = {
  nodes: GiantNode[];
  edges: GiantEdge[];
  width: number;
  height: number;
};

export const GIANT = {
  root: { w: 200, h: 56 },
  area: { w: 220, h: 52 },
  branch: { w: 200, h: 40 },
  feature: { w: 188, h: 30 },
  // Between the area columns, between rows, and a feature's indent under its branch.
  columnGap: 32,
  rowGap: 8,
  levelGap: 56,
  indent: 12,
  // Feature labels show once a feature row is this tall on screen.
  featureLabelPx: 22,
  // The closest and the furthest the camera goes.
  maxScale: 2,
  minScale: 0.08,
} as const;

export function giantLayout(maps: readonly AreaMap[]): GiantLayout {
  const nodes: GiantNode[] = [];
  const edges: GiantEdge[] = [];
  const colW = GIANT.area.w;
  const width = maps.length * colW + Math.max(0, maps.length - 1) * GIANT.columnGap;
  const root: GiantNode = {
    id: "jane",
    level: 1,
    label: "Jane",
    line: "Your financial controller",
    href: "/home",
    parent: null,
    children: maps.map((m) => m.key),
    x: (width - GIANT.root.w) / 2,
    y: 0,
    ...GIANT.root,
  };
  nodes.push(root);
  const areaY = GIANT.root.h + GIANT.levelGap;
  let height = areaY + GIANT.area.h;

  maps.forEach((map, col) => {
    const x = col * (colW + GIANT.columnGap);
    const area: GiantNode = {
      id: map.key,
      level: 2,
      label: map.name,
      line: `${map.features} things · ${map.forYou} for you`,
      forYou: map.forYou > 0,
      href: map.href,
      parent: root.id,
      children: map.branches.map((b) => `${map.key}/${b.id}`),
      x,
      y: areaY,
      ...GIANT.area,
    };
    nodes.push(area);
    edges.push(edge(root, area, "down"));

    let y = areaY + GIANT.area.h + GIANT.levelGap / 2;
    for (const b of map.branches) {
      const id = `${map.key}/${b.id}`;
      const branch: GiantNode = {
        id,
        level: 3,
        label: b.name,
        line: b.forYou > 0 ? `${b.forYou} for you` : `${b.features.length} things`,
        forYou: b.forYou > 0,
        href: map.href,
        parent: area.id,
        children: b.features.map((f) => `${id}/${f.id}`),
        x: x + GIANT.indent,
        y,
        ...GIANT.branch,
      };
      nodes.push(branch);
      edges.push(edge(area, branch, "side"));
      y += GIANT.branch.h + GIANT.rowGap;
      for (const f of b.features) {
        const feature: GiantNode = {
          id: `${id}/${f.id}`,
          level: 4,
          label: f.name,
          line: f.line,
          forYou: f.forYou,
          href: f.href,
          ask: f.ask,
          parent: id,
          children: [],
          x: x + GIANT.indent * 2 + 8,
          y,
          ...GIANT.feature,
        };
        nodes.push(feature);
        edges.push(edge(branch, feature, "side"));
        y += GIANT.feature.h + GIANT.rowGap;
      }
      y += GIANT.rowGap;
    }
    height = Math.max(height, y);
  });

  return { nodes, edges, width, height };
}

// Root to area: from the bottom of one to the top of the other. Within a column: from the
// parent's left edge, down and in to the child's left edge.
function edge(from: GiantNode, to: GiantNode, way: "down" | "side"): GiantEdge {
  return way === "down"
    ? {
        id: `${from.id}>${to.id}`,
        way,
        from: { x: from.x + from.w / 2, y: from.y + from.h },
        to: { x: to.x + to.w / 2, y: to.y },
      }
    : {
        id: `${from.id}>${to.id}`,
        way,
        from: { x: from.x + 6, y: from.y + from.h },
        to: { x: to.x, y: to.y + to.h / 2 },
      };
}

export function giantEdgePath(e: GiantEdge): string {
  // Down and in, as a tree is drawn in a terminal (└─).
  if (e.way === "side") return `M${e.from.x},${e.from.y} V${e.to.y} H${e.to.x}`;
  const mid = (e.from.y + e.to.y) / 2;
  return `M${e.from.x},${e.from.y} C${e.from.x},${mid} ${e.to.x},${mid} ${e.to.x},${e.to.y}`;
}

// The camera: the world's scale and where its origin sits on screen.
export type Camera = { k: number; x: number; y: number };

const clampK = (k: number) => Math.min(GIANT.maxScale, Math.max(GIANT.minScale, k));

// The whole tree in view, centred, with a margin.
export function fitCamera(
  layout: Pick<GiantLayout, "width" | "height">,
  view: { w: number; h: number },
  margin = 16,
): Camera {
  const k = clampK(
    Math.min((view.w - margin * 2) / layout.width, (view.h - margin * 2) / layout.height, 1),
  );
  return { k, x: (view.w - layout.width * k) / 2, y: margin };
}

// Zoomed by `factor` around a point on screen (the pointer, a pinch's middle, or the centre).
export function zoomAt(camera: Camera, factor: number, px: number, py: number): Camera {
  const k = clampK(camera.k * factor);
  const f = k / camera.k;
  return { k, x: px - (px - camera.x) * f, y: py - (py - camera.y) * f };
}

// A node in the middle of the view, at least close enough to read it.
export function centerOn(
  node: Pick<GiantNode, "x" | "y" | "w" | "h" | "level">,
  view: { w: number; h: number },
  camera: Camera,
): Camera {
  const k = clampK(Math.max(camera.k, readableScale(node.level)));
  return {
    k,
    x: view.w / 2 - (node.x + node.w / 2) * k,
    y: view.h / 2 - (node.y + node.h / 2) * k,
  };
}

// The scale at which a level's labels are drawn: features once their rows are tall enough to
// read; the areas and branches always (their labels keep a readable size on screen).
export function readableScale(level: GiantLevel): number {
  return level === 4 ? GIANT.featureLabelPx / GIANT.feature.h : 0;
}

export function showsLabels(level: GiantLevel, k: number): boolean {
  return k >= readableScale(level);
}
