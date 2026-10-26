import {
  EVENT_TYPES,
  EVENTS_USER_AGENT,
  GDELT_DOC_URL,
  GDELT_SPACING_MS,
  type EventTypeId,
} from "@/config/events";
import type { Coverage } from "@/planning/event-detect";

// GDELT's DOC 2.0 API (free, keyless): each event type's daily article count and the day's total,
// for its query (src/config/events.ts). The URL and the parsing are checked against a recorded
// response; the live call is made by the daily events job only, one request at a time, as GDELT
// asks.

const stamp = (iso: string, end = false) =>
  `${iso.replaceAll("-", "")}${end ? "235959" : "000000"}`;

export const gdeltUrl = (query: string, from: string, to: string) =>
  `${GDELT_DOC_URL}?query=${encodeURIComponent(query)}&mode=timelinevolraw&format=json&startdatetime=${stamp(from)}&enddatetime=${stamp(to, true)}`;

type Timeline = {
  timeline?: { series?: string; data?: { date: string; value: number; norm?: number }[] }[];
};

// "20240113T000000Z" → "2024-01-13"; count is the query's articles, total all articles.
export function parseTimeline(json: Timeline): Coverage[] {
  const data = json.timeline?.[0]?.data ?? [];
  return data.flatMap((d) => {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(d.date);
    if (!m || typeof d.value !== "number" || !d.norm) return [];
    return [{ date: `${m[1]}-${m[2]}-${m[3]}`, count: d.value, total: d.norm }];
  });
}

export type Fetcher = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Each type's coverage from..to, one request per type, GDELT_SPACING_MS apart. A type whose
// request fails is left out (and named), so one slow answer doesn't stop the rest.
export async function fetchCoverage(
  types: readonly EventTypeId[],
  from: string,
  to: string,
  { fetcher = fetch as unknown as Fetcher, spacingMs = GDELT_SPACING_MS } = {},
): Promise<{ coverage: Partial<Record<EventTypeId, Coverage[]>>; failed: EventTypeId[] }> {
  const coverage: Partial<Record<EventTypeId, Coverage[]>> = {};
  const failed: EventTypeId[] = [];
  for (const [i, type] of types.entries()) {
    if (i > 0 && spacingMs > 0) await wait(spacingMs);
    try {
      const res = await fetcher(gdeltUrl(EVENT_TYPES[type].gdelt, from, to), {
        headers: { "User-Agent": EVENTS_USER_AGENT },
      });
      const text = await res.text();
      // GDELT answers a too-fast caller with a plain-text note, not JSON.
      if (!res.ok || !text.trim().startsWith("{")) throw new Error(`GDELT ${res.status}`);
      coverage[type] = parseTimeline(JSON.parse(text) as Timeline);
    } catch {
      failed.push(type);
    }
  }
  return { coverage, failed };
}
