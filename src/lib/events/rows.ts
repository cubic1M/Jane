import type { EventTypeId } from "@/config/events";
import type { MarketEvent } from "@/planning/event-detect";

// A stored market_events row as the overlay's MarketEvent.
export const toEvent = (r: {
  key: string;
  type: string;
  source: string;
  date: Date;
  knownAt: Date;
  title: string;
  url: string | null;
  strength: number;
}): MarketEvent => ({
  key: r.key,
  type: r.type as EventTypeId,
  source: r.source as MarketEvent["source"],
  date: r.date.toISOString().slice(0, 10),
  knownAt: r.knownAt.toISOString(),
  title: r.title,
  url: r.url,
  strength: r.strength,
});
