import { readFileSync } from "node:fs";
import { EVENT_TYPE_IDS, type EventTypeId } from "@/config/events";
import type { Coverage } from "@/planning/event-detect";

// The recorded GDELT coverage (./README.md) by event type, for the backtest and its tests only:
// the app never imports this.
export const GDELT_FIXTURE_SOURCE =
  "GDELT DOC 2.0 daily article counts (timelinevolraw), 2017-01-01 to 2026-10-25, recorded 2026-10-26";

let cached: Record<EventTypeId, Coverage[]> | null = null;

export function gdeltFixtureCoverage(): Record<EventTypeId, Coverage[]> {
  if (cached) return cached;
  const [header, ...rows] = readFileSync(new URL("./gdelt-coverage.csv", import.meta.url), "utf8")
    .trim()
    .split("\n");
  const columns = header.split(",");
  const out = Object.fromEntries(EVENT_TYPE_IDS.map((t) => [t, [] as Coverage[]])) as Record<
    EventTypeId,
    Coverage[]
  >;
  for (const row of rows) {
    const cells = row.split(",");
    const date = cells[0];
    const total = Number(cells[1]);
    columns.slice(2).forEach((type, i) => {
      const count = cells[i + 2];
      if (count !== "" && type in out)
        out[type as EventTypeId].push({ date, count: Number(count), total });
    });
  }
  cached = out;
  return out;
}
