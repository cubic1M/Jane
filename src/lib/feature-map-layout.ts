import { MAP_GAP, MAP_MIN_SCALE, MAP_NARROW_PX, MAP_NODE } from "@/config/feature-map";
import type { AreaMap } from "./feature-map";

// Where the feature map's nodes sit (docs/design/home-hub.md): a left-to-right tree, the area
// on the left, its branches in a column, and the open branch's features in a column beside it,
// centred on the branch. And the camera: how far to zoom and pan so the open branch fills the
// view. Pure, so it is tested; src/components/feature-tree.tsx draws it.

export type Box = { x: number; y: number; w: number; h: number };
export type PlacedNode = Box & { id: string; level: 1 | 2 | 3 };
export type Edge = { id: string; from: { x: number; y: number }; to: { x: number; y: number } };

export type MapLayout = {
  nodes: PlacedNode[];
  edges: Edge[];
  width: number;
  height: number;
  // What the camera should show.
  focus: Box;
};

const right = (b: Box) => ({ x: b.x + b.w, y: b.y + b.h / 2 });
const left = (b: Box) => ({ x: b.x, y: b.y + b.h / 2 });

export function layoutMap(map: AreaMap, open: string | null, viewWidth: number): MapLayout {
  const { root, group, feature } = MAP_NODE;
  const branchX = root.w + MAP_GAP.column;
  const featureX = branchX + group.w + MAP_GAP.column;
  const branchesH = Math.max(
    root.h,
    map.branches.length * group.h + Math.max(0, map.branches.length - 1) * MAP_GAP.group,
  );
  const rootBox: PlacedNode = {
    id: map.key,
    level: 1,
    x: 0,
    y: (branchesH - root.h) / 2,
    w: root.w,
    h: root.h,
  };
  const branchBoxes: PlacedNode[] = map.branches.map((b, i) => ({
    id: b.id,
    level: 2,
    x: branchX,
    y: i * (group.h + MAP_GAP.group),
    w: group.w,
    h: group.h,
  }));
  const nodes: PlacedNode[] = [rootBox, ...branchBoxes];
  const edges: Edge[] = branchBoxes.map((b) => ({
    id: `${map.key}>${b.id}`,
    from: right(rootBox),
    to: left(b),
  }));

  const openIndex = map.branches.findIndex((b) => b.id === open);
  let height = branchesH;
  let width = branchX + group.w;
  let focus: Box = { x: 0, y: 0, w: width, h: height };
  if (openIndex >= 0) {
    const branch = map.branches[openIndex];
    const box = branchBoxes[openIndex];
    const columnH =
      branch.features.length * feature.h +
      Math.max(0, branch.features.length - 1) * MAP_GAP.feature;
    // Centred on the branch, never above the top.
    const top = Math.max(0, box.y + box.h / 2 - columnH / 2);
    branch.features.forEach((f, i) => {
      const placed: PlacedNode = {
        id: f.id,
        level: 3,
        x: featureX,
        y: top + i * (feature.h + MAP_GAP.feature),
        w: feature.w,
        h: feature.h,
      };
      nodes.push(placed);
      edges.push({ id: `${branch.id}>${f.id}`, from: right(box), to: left(placed) });
    });
    width = featureX + feature.w;
    height = Math.max(height, top + columnH);
    // The whole tree when it fits; else a phone shows the features with an edge of their
    // branch, and wider screens the branch too.
    focus =
      width <= viewWidth
        ? { x: 0, y: 0, w: width, h: height }
        : viewWidth < MAP_NARROW_PX
          ? { x: featureX - 24, y: top, w: feature.w + 24, h: columnH }
          : {
              x: branchX,
              y: Math.min(box.y, top),
              w: featureX + feature.w - branchX,
              h: Math.max(box.y + box.h, top + columnH) - Math.min(box.y, top),
            };
  }
  return { nodes, edges, width, height, focus };
}

export type Camera = { x: number; scale: number };

// Zoom so the focus fits the view's width (never past full size, never below the floor), and
// pan so it sits in the middle, without showing empty space past the map's left edge.
export function cameraFor(focus: Box, viewWidth: number): Camera {
  const scale = Math.min(1, Math.max(MAP_MIN_SCALE, viewWidth / focus.w));
  const centred = (viewWidth - focus.w * scale) / 2 - focus.x * scale;
  return { scale, x: Math.min(0, centred) };
}

// A gentle curve from a parent's right edge to a child's left edge.
export function edgePath(e: Edge): string {
  const mid = (e.from.x + e.to.x) / 2;
  return `M${e.from.x},${e.from.y} C${mid},${e.from.y} ${mid},${e.to.y} ${e.to.x},${e.to.y}`;
}
