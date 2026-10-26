import type { Ref } from "react";
import { MARCHING_LINE } from "@/config/motion";

// The one marching dotted line (src/config/motion.ts, MARCHING_LINE): the Ask Jane line to the
// chat, the net worth's More details, the calculation pop-ups and the investments panel all draw
// it, so they look and move the same. Its colour and march are .marching-line in globals.css.
export function MarchingPath({ d, ref }: { d?: string; ref?: Ref<SVGPathElement> }) {
  return (
    <path
      ref={ref}
      d={d}
      fill="none"
      strokeWidth={MARCHING_LINE.width}
      strokeDasharray={MARCHING_LINE.dash}
      className="marching-line"
      data-marching-line=""
    />
  );
}
