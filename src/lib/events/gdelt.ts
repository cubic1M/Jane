import {
  EVENT_TYPES,
  EVENTS_REQUEST_TIMEOUT_MS,
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
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type GdeltOptions = {
  fetcher?: Fetcher;
  spacingMs?: number;
  // A request not answered in this long counts as failed (EVENTS_REQUEST_TIMEOUT_MS by default).
  timeoutMs?: number;
  // Epoch ms: no request starts after it; the types left count as failed.
  deadline?: number;
};

// One type's answer, as text; a refusal, a non-JSON note (GDELT answers a too-fast caller with a
// plain-text note) or no answer in time throws.
async function ask(url: string, fetcher: Fetcher, timeoutMs: number) {
  const res = await fetcher(url, {
    headers: { "User-Agent": EVENTS_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok || !text.trim().startsWith("{")) throw new Error(`GDELT ${res.status}`);
  return JSON.parse(text) as Timeline;
}

const outOfTime = (deadline: number | undefined, pauseMs: number) =>
  deadline !== undefined && Date.now() + pauseMs >= deadline;

// Each type's coverage from..to, one request per type, GDELT_SPACING_MS apart. A type whose
// request fails, or isn't asked before the deadline, is left out (and named), so one slow answer
// doesn't stop the rest.
export async function fetchCoverage(
  types: readonly EventTypeId[],
  from: string,
  to: string,
  {
    fetcher = fetch as unknown as Fetcher,
    spacingMs = GDELT_SPACING_MS,
    timeoutMs = EVENTS_REQUEST_TIMEOUT_MS,
    deadline,
  }: GdeltOptions = {},
): Promise<{ coverage: Partial<Record<EventTypeId, Coverage[]>>; failed: EventTypeId[] }> {
  const coverage: Partial<Record<EventTypeId, Coverage[]>> = {};
  const failed: EventTypeId[] = [];
  for (const [i, type] of types.entries()) {
    const pause = i > 0 ? spacingMs : 0;
    if (outOfTime(deadline, pause)) {
      failed.push(type);
      continue;
    }
    if (pause > 0) await wait(pause);
    try {
      coverage[type] = parseTimeline(
        await ask(gdeltUrl(EVENT_TYPES[type].gdelt, from, to), fetcher, timeoutMs),
      );
    } catch {
      failed.push(type);
    }
  }
  return { coverage, failed };
}

// One 15-minute bucket of GDELT coverage: when it starts, its articles and all articles then.
export type CoverageAt = { at: string; count: number; total: number };

// A window to the minute ("20261026T071500Z"): GDELT answers a window of a few days in 15-minute
// buckets.
const stampAt = (iso: string) => iso.slice(0, 19).replaceAll(/[-:T]/g, "");
export const gdeltUrlAt = (query: string, fromIso: string, toIso: string) =>
  `${GDELT_DOC_URL}?query=${encodeURIComponent(query)}&mode=timelinevolraw&format=json&startdatetime=${stampAt(fromIso)}&enddatetime=${stampAt(toIso)}`;

export function parseTimelineAt(json: Timeline): CoverageAt[] {
  const data = json.timeline?.[0]?.data ?? [];
  return data.flatMap((d) => {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(d.date);
    if (!m || typeof d.value !== "number" || !d.norm) return [];
    return [
      { at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`, count: d.value, total: d.norm },
    ];
  });
}

// The last hours of coverage for each type, in 15-minute buckets (for the crypto types, so an
// event around the clock is known within the hour, not the next day). One request per type,
// spaced like the daily ones; `leadMs` waits first, after other requests.
export async function fetchIntraday(
  types: readonly EventTypeId[],
  fromIso: string,
  toIso: string,
  {
    fetcher = fetch as unknown as Fetcher,
    spacingMs = GDELT_SPACING_MS,
    timeoutMs = EVENTS_REQUEST_TIMEOUT_MS,
    deadline,
    leadMs = 0,
  }: GdeltOptions & { leadMs?: number } = {},
): Promise<{ coverage: Partial<Record<EventTypeId, CoverageAt[]>>; failed: EventTypeId[] }> {
  const coverage: Partial<Record<EventTypeId, CoverageAt[]>> = {};
  const failed: EventTypeId[] = [];
  for (const [i, type] of types.entries()) {
    const pause = i === 0 ? leadMs : spacingMs;
    if (outOfTime(deadline, pause)) {
      failed.push(type);
      continue;
    }
    if (pause > 0) await wait(pause);
    try {
      coverage[type] = parseTimelineAt(
        await ask(gdeltUrlAt(EVENT_TYPES[type].gdelt, fromIso, toIso), fetcher, timeoutMs),
      );
    } catch {
      failed.push(type);
    }
  }
  return { coverage, failed };
}
