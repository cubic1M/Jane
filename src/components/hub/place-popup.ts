// Where a tile's pop-up goes (founder: "a pop up page (linked by dashed animated line) right next
// to it"): beside the tile, on the first side with room, never over the tile itself or anything
// else it must leave in view (the net worth chart, the chat). Pure, in the viewport's pixels.

export type Box = { left: number; top: number; width: number; height: number };
export type Side = "right" | "left" | "below" | "above";

const SIDES: readonly Side[] = ["right", "left", "below", "above"];

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

const clamp = (n: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, n)));

export function placePopup({
  anchor,
  size,
  viewport,
  near,
  avoid = [],
  gap = 12,
  margin = 8,
}: {
  // The tile the pop-up belongs to.
  anchor: Box;
  // Beside the tile, it's centred on this height (the button that opened it) but never above the
  // tile's top; else level with the tile's top.
  near?: number;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  // What it must not cover, besides the tile.
  avoid?: Box[];
  gap?: number;
  margin?: number;
}): { left: number; top: number; side: Side } {
  const { width: w, height: h } = size;
  // Never above the tile's own top (the chart is there), and on the screen if it can be.
  const beside = Math.max(
    anchor.top,
    clamp(near === undefined ? anchor.top : near - h / 2, margin, viewport.height - h - margin),
  );
  const across = clamp(anchor.left, margin, viewport.width - w - margin);
  const at: Record<Side, { left: number; top: number }> = {
    right: { left: anchor.left + anchor.width + gap, top: beside },
    left: { left: anchor.left - gap - w, top: beside },
    // Below may run past the bottom of the screen: the page scrolls to it.
    below: { left: across, top: anchor.top + anchor.height + gap },
    above: { left: across, top: anchor.top - gap - h },
  };
  const fits = (side: Side) => {
    const { left, top } = at[side];
    return (
      left >= margin && left + w <= viewport.width - margin && (side !== "above" || top >= margin)
    );
  };
  const covered = (side: Side) =>
    [anchor, ...avoid].reduce(
      (sum, b) => sum + overlap({ ...at[side], width: w, height: h }, b),
      0,
    );
  const roomy = SIDES.filter(fits);
  const clear = roomy.find((side) => covered(side) === 0);
  // Nowhere clear: the side that covers least, and below when nothing fits at all.
  const side =
    clear ??
    (roomy.length > 0
      ? roomy.reduce((best, s) => (covered(s) < covered(best) ? s : best))
      : ("below" as const));
  return { ...at[side], side };
}

// The dashed line from the button that opened it to the pop-up's near edge, as an SVG path.
export function popupLine(from: Box, popup: Box, side: Side): string {
  const midY = from.top + from.height / 2;
  const midX = from.left + from.width / 2;
  const inset = 12;
  if (side === "right" || side === "left") {
    const x1 = side === "right" ? from.left + from.width : from.left;
    const x2 = side === "right" ? popup.left : popup.left + popup.width;
    const y2 = clamp(midY, popup.top + inset, popup.top + popup.height - inset);
    const cx = (x1 + x2) / 2;
    return `M${x1},${midY} C${cx},${midY} ${cx},${y2} ${x2},${y2}`;
  }
  const y1 = side === "below" ? from.top + from.height : from.top;
  const y2 = side === "below" ? popup.top : popup.top + popup.height;
  const x2 = clamp(midX, popup.left + inset, popup.left + popup.width - inset);
  const cy = (y1 + y2) / 2;
  return `M${midX},${y1} C${midX},${cy} ${x2},${cy} ${x2},${y2}`;
}
