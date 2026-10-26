// Icons drawn in square pixels, like the mic (src/app/chat/mic-button.tsx) and the rest of the
// terminal look (founder, 2026-10-24: "Icons match it"). Each is a small picture written as
// text, "#" for a pixel, so a new one is drawn by typing it.

// prettier-ignore
const ART = {
  person: [
    "...####...",
    "..######..",
    "..######..",
    "..######..",
    "...####...",
    "..........",
    ".########.",
    "##########",
    "##########",
    "##########",
  ],
  expand: [
    "#####.....",
    "##........",
    "#.#.......",
    "#..#......",
    "#...#.....",
    ".....#...#",
    "......#..#",
    ".......#.#",
    "........##",
    ".....#####",
  ],
  dock: [
    "#...#.....",
    ".#..#.....",
    "..#.#.....",
    "...##.....",
    ".####.....",
    ".....####.",
    ".....##...",
    ".....#.#..",
    ".....#..#.",
    ".....#...#",
  ],
  collapse: [
    "..##......",
    "...##.....",
    "....##....",
    ".....##...",
    "......##..",
    ".....##...",
    "....##....",
    "...##.....",
    "..##......",
  ],
  close: [
    "##......##",
    ".##....##.",
    "..##..##..",
    "...####...",
    "....##....",
    "...####...",
    "..##..##..",
    ".##....##.",
    "##......##",
  ],
  chevronDown: [
    "##......##",
    ".##....##.",
    "..##..##..",
    "...####...",
    "....##....",
  ],
} as const;

export type PixelIconName = keyof typeof ART;

// One rectangle per run of pixels in a row.
export function pixelRuns(rows: readonly string[]): [number, number, number][] {
  const runs: [number, number, number][] = [];
  rows.forEach((row, y) => {
    for (const m of row.matchAll(/#+/g)) runs.push([m.index ?? 0, y, m[0].length]);
  });
  return runs;
}

export function PixelIcon({
  name,
  className = "size-5",
}: {
  name: PixelIconName;
  className?: string;
}) {
  const rows = ART[name];
  const width = Math.max(...rows.map((r) => r.length));
  // Square, with the picture centred, so every icon sits the same in its button.
  const side = Math.max(width, rows.length);
  const dx = (side - width) / 2;
  const dy = (side - rows.length) / 2;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      className={`fill-current ${className}`}
      data-pixel-icon={name}
    >
      {pixelRuns(rows).map(([x, y, w]) => (
        <rect key={`${x}-${y}`} x={x + dx} y={y + dy} width={w} height={1} />
      ))}
    </svg>
  );
}
