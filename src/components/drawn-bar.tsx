import type { CSSProperties } from "react";

// A progress bar drawn, not typed (readable style, founder 11-18): a bar, then "52% · Reading
// transactions" beside it. It was "[████████░░░░░░░░] 52% · reading transactions". The bar is
// decoration: the progressbar around it carries the value for a screen reader. Its size and
// colours are in its own style, so a slow phone draws it before the stylesheet arrives (as
// Home's skeleton, src/components/hub/home-loading.tsx).

const TRACK: CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  width: "7rem",
  height: 6,
  overflow: "hidden",
  background: "rgba(127, 127, 127, 0.3)",
};
const FILL: CSSProperties = { display: "block", height: "100%", background: "currentColor" };

export function barPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function barWords(percent: number, label: string): string {
  return `${barPercent(percent)}% · ${label}`;
}

// Goes in a row (flex, with a gap): the bar, then its words, cut at their end when short of room.
export function DrawnBar({ percent, label }: { percent: number; label: string }) {
  return (
    <>
      <span aria-hidden="true" data-drawn-bar="" style={TRACK}>
        <span
          className="motion-safe:transition-[width] motion-safe:duration-500"
          style={{ ...FILL, width: `${barPercent(percent)}%` }}
        />
      </span>
      <span className="min-w-0 truncate">{barWords(percent, label)}</span>
    </>
  );
}
