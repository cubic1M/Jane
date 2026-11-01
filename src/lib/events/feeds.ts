import {
  CPI_HOT_MONTHLY_PCT,
  EVENT_FEEDS,
  EVENTS_REQUEST_TIMEOUT_MS,
  EVENTS_USER_AGENT,
  EVENT_TYPES,
} from "@/config/events";
import { classifyText, nextDay, type MarketEvent } from "@/planning/event-detect";
import type { Fetcher } from "./gdelt";

// The official feeds the events overlay reads (free, keyless): the Fed's monetary policy press
// releases (and, for an FOMC statement, its decision sentence), BLS's CPI releases and EIA's Today
// in Energy. Plus the headlines step 293 stores. Each item is read by rules: a pattern match, or
// for the CPI the month's rise against CPI_HOT_MONTHLY_PCT. Checked against recorded responses.

export type FeedItem = { title: string; link: string | null; published: string; summary: string };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};
const clean = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#39;/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
const tag = (block: string, name: string) =>
  new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1] ?? "";
const iso = (date: string) => {
  const t = Date.parse(clean(date));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// RSS 2.0 <item>s and Atom <entry>s, newest first as the feed gives them.
export function parseFeed(xml: string): FeedItem[] {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return items.flatMap((block) => {
    const published = iso(
      tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"),
    );
    if (!published) return [];
    const href = /<link\b[^>]*href="([^"]+)"/i.exec(block)?.[1];
    return [
      {
        title: clean(tag(block, "title")),
        link: href ?? (clean(tag(block, "link")) || null),
        published,
        summary: clean(tag(block, "description") || tag(block, "content") || tag(block, "summary")),
      },
    ];
  });
}

const dayOf = (isoTime: string) => isoTime.slice(0, 10);

// An FOMC statement's decision: "decided to raise / lower / maintain the target range".
export function fomcDecision(html: string): "fed_hike" | "fed_cut" | null {
  const m = /decided to (raise|lower|maintain) the target range/i.exec(clean(html));
  if (!m) return null;
  const verb = m[1].toLowerCase();
  return verb === "raise" ? "fed_hike" : verb === "lower" ? "fed_cut" : null;
}

// The Fed's monetary releases: an FOMC statement by its decision (its page read with `page`);
// other releases by their title's keywords, for the rate types only.
export async function fedEvents(
  items: readonly FeedItem[],
  page: (url: string) => Promise<string | null>,
): Promise<MarketEvent[]> {
  const out: MarketEvent[] = [];
  for (const item of items) {
    let type: "fed_hike" | "fed_cut" | null = null;
    if (/\bFOMC statement\b/i.test(item.title) && item.link) {
      const html = await page(item.link);
      type = html ? fomcDecision(html) : null;
    } else {
      const found = classifyText(`${item.title}. ${item.summary}`).find(
        (c) => c.type === "fed_cut" || c.type === "fed_hike",
      );
      type = (found?.type as "fed_hike" | "fed_cut" | undefined) ?? null;
    }
    if (!type) continue;
    out.push({
      key: `fed:${type}:${dayOf(item.published)}`,
      type,
      source: "fed",
      date: dayOf(item.published),
      knownAt: item.published,
      title: `${EVENT_TYPES[type].label}: ${item.title}`,
      url: item.link,
      strength: 1,
    });
  }
  return out;
}

// BLS's CPI releases: hot when all items rose at least CPI_HOT_MONTHLY_PCT in the month
// ("CPI for all items increases 0.6% in September").
export function cpiEvents(items: readonly FeedItem[]): MarketEvent[] {
  return items.flatMap((item) => {
    const m =
      /\ball items (rises|rose|increases?|increased|up)\s+(\d+(?:\.\d+)?)\s*(%|percent)/i.exec(
        `${item.title} ${item.summary}`,
      );
    if (!m || Number(m[2]) < CPI_HOT_MONTHLY_PCT) return [];
    return [
      {
        key: `bls:inflation_hot:${dayOf(item.published)}`,
        type: "inflation_hot" as const,
        source: "bls" as const,
        date: dayOf(item.published),
        knownAt: item.published,
        title: `${EVENT_TYPES.inflation_hot.label}: ${item.title}`,
        url: item.link,
        strength: Number(m[2]),
      },
    ];
  });
}

// EIA's Today in Energy: an oil supply shock by its keywords only.
export function eiaEvents(items: readonly FeedItem[]): MarketEvent[] {
  return items.flatMap((item) =>
    classifyText(`${item.title}. ${item.summary}`).some((c) => c.type === "oil_shock")
      ? [
          {
            key: `eia:oil_shock:${dayOf(item.published)}`,
            type: "oil_shock" as const,
            source: "eia" as const,
            date: dayOf(item.published),
            knownAt: item.published,
            title: `${EVENT_TYPES.oil_shock.label}: ${item.title}`,
            url: item.link,
            strength: 1,
          },
        ]
      : [],
  );
}

// Stored headlines (step 293's market_news): the best-matching type, if any. A headline is
// dated by day only, so it counts as known when that day ends.
export function headlineEvents(
  headlines: readonly { date: string; title: string; url: string | null }[],
): MarketEvent[] {
  return headlines.flatMap((h) => {
    const best = classifyText(h.title)[0];
    if (!best) return [];
    return [
      {
        key: `news:${best.type}:${h.date}`,
        type: best.type,
        source: "news" as const,
        date: h.date,
        knownAt: `${nextDay(h.date)}T00:00:00.000Z`,
        title: `${EVENT_TYPES[best.type].label}: ${h.title}`,
        url: h.url,
        strength: best.score,
      },
    ];
  });
}

async function text(url: string, fetcher: Fetcher): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      headers: { "User-Agent": EVENTS_USER_AGENT },
      signal: AbortSignal.timeout(EVENTS_REQUEST_TIMEOUT_MS),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// Every feed's events now. A feed that doesn't answer gives none; the rest go on.
export async function feedEvents({
  fetcher = fetch as unknown as Fetcher,
}: { fetcher?: Fetcher } = {}): Promise<{ events: MarketEvent[]; failed: string[] }> {
  const failed: string[] = [];
  const read = async (name: keyof typeof EVENT_FEEDS) => {
    const xml = await text(EVENT_FEEDS[name], fetcher);
    if (xml === null) failed.push(name);
    return xml ? parseFeed(xml) : [];
  };
  const [fed, cpi, eia] = await Promise.all([read("fed"), read("bls_cpi"), read("eia")]);
  return {
    events: [
      ...(await fedEvents(fed, (url) => text(url, fetcher))),
      ...cpiEvents(cpi),
      ...eiaEvents(eia),
    ],
    failed,
  };
}
