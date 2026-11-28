import type { CSSProperties } from "react";
import { AppHeaderLoading } from "@/components/app-header";
import { ArriveAtTop } from "./arrive-at-top";

// Home while it loads, on a slow phone for seconds (mobile pass 11-16: at 1.5 s a blank page under
// the header, no sign anything was coming): the first screen's shape in plain blocks, no words.
// The net worth card with its chart's room (190 px on a phone, 260 wider, as the chart itself),
// only (the Saved tile shows once there is something saved). It is still the page's loading bar to the code and tests
// that wait for one (data-loading-bar), and says so to a screen reader.
//
// A slow phone draws this before the stylesheet arrives (none loaded at 1.5 s and 3 s), so the
// blocks carry their size and a grey that reads on light and dark in their own style; the classes
// take over once it's in.
const GREY = "rgba(127, 127, 127, 0.18)";
const LINE = "1px solid rgba(127, 127, 127, 0.35)";
const BLOCK = "bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800";
const CARD = "flex flex-col gap-3 border border-zinc-300 p-4 dark:border-zinc-700";
const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  border: LINE,
};
const block = (height: number, width: number | string): CSSProperties => ({
  minHeight: height,
  width,
  maxWidth: "100%",
  background: GREY,
});

export function HomeLoading() {
  return (
    <>
      <ArriveAtTop />
      <AppHeaderLoading />
      <div
        role="progressbar"
        aria-label="Loading your hub"
        data-loading-bar=""
        data-home-loading=""
        className="flex flex-col gap-6"
        style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 16 }}
      >
        <div className={CARD} style={card}>
          <div className={BLOCK} style={block(16, 96)} />
          <div className={BLOCK} style={block(48, 192)} />
          <div className={`w-full sm:h-[260px] ${BLOCK}`} style={block(190, "100%")} />
        </div>
      </div>
    </>
  );
}
