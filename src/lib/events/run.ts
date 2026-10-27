import { EVENT_EVIDENCE } from "@/config/event-evidence";
import {
  EVENT_CATCH_UP_DAYS,
  EVENT_FRESH_DAYS,
  EVENT_STORE_DAYS,
  EVENT_TYPES,
  EVENT_TYPE_IDS,
  GDELT_INTRADAY_HOURS,
  GDELT_SPACING_MS,
  eventTypesFor,
  GDELT_BASELINE_DAYS,
  PRICE_SHOCKS,
  type EventTypeId,
} from "@/config/events";
import { PAPER_MIN_TRADE_CENTS } from "@/config/paper";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { checkGuardrails } from "@/lib/guardrails";
import type { Bar } from "@/lib/market/types";
import { strategyOf, takeSignal } from "@/lib/paper/account";
import { daysBefore, paperPrices, type PaperPrices } from "@/lib/paper/prices";
import { strategyTargets } from "@/lib/paper/targets";
import { coverageSpikes, hourlySpikes, priceShocks, withCoolOff } from "@/planning/event-detect";
import { closeOrders, openOrders } from "@/planning/event-orders";
import {
  emptyOverlay,
  overlayStep,
  type EventSlice,
  type OverlayAction,
  type OverlayState,
} from "@/planning/event-overlay";
import { mixWeights, type PaperOrder } from "@/planning/paper";
import { feedEvents, headlineEvents } from "./feeds";
import { fetchCoverage, fetchIntraday, type Fetcher } from "./gdelt";
import { toEvent } from "./rows";

// The events overlay, live (founder, 2026-10-26). Once a day after the close (Vercel Cron), the
// events job reads GDELT's coverage, the Fed's, BLS's and EIA's feeds, the stored headlines and
// the day's price moves, and stores each new event with the time it became public. Then, for
// every paper account whose overlay is on, it runs the overlay's rules (src/planning/
// event-overlay.ts) for each close since its last run (catching up a missed day), and places the
// paper trades itself: simulated money only, never a real order. Each action is logged with the
// event that set it off, and surfaces in the trade pop-up. Demo advice only (advice mode): a real
// account's overlay never runs. Rules only: no Claude call.

export type Options = {
  client?: PrismaClient;
  now?: Date;
  prices?: PaperPrices;
  fetcher?: Fetcher;
  // Between GDELT requests (GDELT_SPACING_MS by default; tests pass 0).
  spacingMs?: number;
};

const DAY_MS = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

export type CollectReport = {
  found: number;
  stored: number;
  failed: string[];
  // The GDELT event types asked about this time (a page view's refresh asks about a few).
  gdelt: EventTypeId[];
};

// Today's events from every source, kept once per type per cool-off (against what is stored),
// stored with the time each became public. A source that fails is named; the rest go on.
export async function collectEvents({
  client = defaultClient,
  now = new Date(),
  prices,
  fetcher = fetch as unknown as Fetcher,
  spacingMs,
  types = EVENT_TYPE_IDS,
}: Options & { types?: readonly EventTypeId[] } = {}): Promise<CollectReport> {
  const today = dayOf(now);
  // GDELT's days are complete only once they end (UTC): yesterday is the last whole one.
  const yesterday = dayOf(new Date(now.getTime() - DAY_MS));
  const fresh = daysBefore(today, EVENT_FRESH_DAYS);
  const failed: string[] = [];

  const gdelt = await fetchCoverage(
    types,
    daysBefore(yesterday, GDELT_BASELINE_DAYS + 10),
    yesterday,
    { fetcher, ...(spacingMs === undefined ? {} : { spacingMs }) },
  );
  failed.push(...gdelt.failed.map((t) => `gdelt:${t}`));
  const spikes = types.flatMap((t) => coverageSpikes(t, gdelt.coverage[t] ?? []));
  // Crypto trades around the clock: its types are also read hour by hour, so an event is known
  // within the hour, not the next day.
  const cryptoTypes = types.filter((t) => EVENT_TYPES[t].market === "crypto");
  if (cryptoTypes.length > 0) {
    const intraday = await fetchIntraday(
      cryptoTypes,
      new Date(now.getTime() - GDELT_INTRADAY_HOURS * 3_600_000).toISOString(),
      now.toISOString(),
      {
        fetcher,
        ...(spacingMs === undefined ? {} : { spacingMs }),
        leadMs: spacingMs ?? GDELT_SPACING_MS,
      },
    );
    failed.push(...intraday.failed.map((t) => `gdelt:${t}`));
    for (const t of cryptoTypes)
      spikes.push(
        ...hourlySpikes(t, intraday.coverage[t] ?? [], gdelt.coverage[t] ?? [], now.toISOString()),
      );
  }

  const feeds = await feedEvents({ fetcher });
  failed.push(...feeds.failed);

  const headlines = await client.marketNews.findMany({
    where: { kind: "headline", date: { gte: dateOf(fresh) } },
    select: { date: true, title: true, url: true },
  });
  const news = headlineEvents(headlines.map((h) => ({ ...h, date: dayOf(h.date) })));

  const source = prices ?? paperPrices();
  const bars: Record<string, Bar[]> = {};
  for (const s of PRICE_SHOCKS) {
    try {
      bars[s.ticker] = await source.closes(s.fetchAs ?? s.ticker, daysBefore(today, 10), today);
    } catch {
      failed.push(`prices:${s.ticker}`);
    }
  }
  const shocks = priceShocks(bars);

  // Stored back to EVENT_STORE_DAYS, so the box can show the most recent events even when none is
  // fresh; the overlay acts only on fresh ones (from just before it was switched on).
  const kept30 = daysBefore(today, EVENT_STORE_DAYS);
  const found = [...spikes, ...feeds.events, ...news, ...shocks].filter(
    (e) => e.date >= kept30 && e.knownAt <= now.toISOString(),
  );
  const stored = (
    await client.marketEvent.findMany({
      where: { date: { gte: dateOf(daysBefore(today, EVENT_STORE_DAYS + 30)) } },
    })
  ).map(toEvent);
  const storedKeys = new Set(stored.map((e) => e.key));
  const kept = withCoolOff([...stored, ...found]).filter((e) => !storedKeys.has(e.key));
  if (kept.length > 0)
    await client.marketEvent.createMany({
      data: kept.map((e) => ({
        key: e.key,
        type: e.type,
        source: e.source,
        date: dateOf(e.date),
        knownAt: new Date(e.knownAt),
        title: e.title,
        url: e.url,
        strength: e.strength,
      })),
      skipDuplicates: true,
    });
  return { found: found.length, stored: kept.length, failed, gdelt: [...types] };
}

type LiveState = OverlayState & { open: (EventSlice & { units?: number })[] };
const readState = (json: Prisma.JsonValue): LiveState => {
  const s = (json ?? {}) as Partial<LiveState>;
  return {
    open: s.open ?? [],
    watching: s.watching ?? [],
    closed: s.closed ?? [],
    seen: s.seen ?? [],
  };
};

// What one action's reason says: the overlay's own words, checked by the demo advice guardrail
// (a reason that fails falls back to the event and the plain rule).
function checked(reason: string, type: EventTypeId): string {
  if (checkGuardrails(reason, [], undefined, "demo_advice").ok) return reason;
  return `${EVENT_TYPES[type].label}. The events overlay's rule.`;
}

export type OverlayReport = { ran: boolean; days: number; trades: number; actions: number };

// One account's overlay, for each close since it last ran (at most EVENT_CATCH_UP_DAYS), and the
// paper trades its actions call for, placed at that close's price.
export async function runEventOverlay(
  userId: string,
  { client = defaultClient, now = new Date(), prices }: Options = {},
): Promise<OverlayReport> {
  const none = { ran: false, days: 0, trades: 0, actions: 0 };
  const db = scopedFor(userId, client);
  if (!(await adviceMode(userId, { client }))) return none;
  const account = await db.paperAccounts.findFirst({
    select: { id: true, level: true, agentPolicy: true },
  });
  if (!account) return none;
  // On by default (founder, 2026-10-26): an account without a row yet gets one, switched on now,
  // so it acts on the last few days' events from here.
  const overlay =
    (await db.paperEventOverlays.findFirst({})) ??
    (await db.paperEventOverlays.create({
      data: {
        accountId: account.id,
        userId,
        on: true,
        switchedAt: now,
        state: emptyOverlay() as unknown as Prisma.InputJsonValue,
      },
    }));
  if (!overlay.on || account.id !== overlay.accountId) return none;
  // The 24-hour agent runs this account: it takes the overlay's slices as its own signals
  // (./agent-source.ts), so the overlay places no trades of its own here and nothing trades twice.
  if (account.agentPolicy) return none;

  const source = prices ?? paperPrices();
  const today = dayOf(now);
  const { key, level } = await strategyOf(userId, { client, now });
  const base = (await strategyTargets(key, level, today, source))?.targets ?? mixWeights(level);
  // Missed closes are caught up only after a first run; the first acts at the latest close, as
  // the paper account's own trades do.
  const last = overlay.lastDate ? dayOf(overlay.lastDate) : null;

  const legTickers = Object.values(EVENT_TYPES).flatMap((t) => t.legs.flatMap((l) => l.tickers));
  const tickers = [...new Set([...Object.keys(base), ...legTickers, "BIL"])];
  const bars: Record<string, Bar[]> = {};
  for (const t of tickers) {
    try {
      bars[t] = await source.closes(t, daysBefore(last ?? today, 14), today);
    } catch {
      bars[t] = [];
    }
  }
  const closes = (bars[Object.keys(base)[0]] ?? []).map((b) => b.date).filter((d) => d <= today);
  const spine = last
    ? closes.filter((d) => d > last).slice(-EVENT_CATCH_UP_DAYS)
    : closes.slice(-1);
  if (spine.length === 0) return none;
  const closesOn = (date: string) =>
    Object.fromEntries(
      tickers.flatMap((t) => {
        const bar = bars[t].filter((b) => b.date <= date).at(-1);
        return bar ? [[t, bar.closeCents]] : [];
      }),
    ) as Record<string, number>;

  // Events from just before the overlay was switched on: it doesn't trade on last month's news.
  // The paper account's own strategies hold stock funds: its overlay reads the stock-fund events
  // (crypto events go to the 24-hour agent on crypto, ./agent-source.ts).
  const events = (
    await client.marketEvent.findMany({
      where: {
        knownAt: { lte: now },
        date: { gte: dateOf(daysBefore(dayOf(overlay.switchedAt), EVENT_FRESH_DAYS)) },
        type: { in: eventTypesFor("stocks") },
      },
      orderBy: { knownAt: "asc" },
    })
  ).map(toEvent);

  let state = readState(overlay.state);
  let trades = 0;
  let count = 0;
  for (const date of spine) {
    const p = closesOn(date);
    const step = overlayStep(state, {
      date,
      level: account.level as 1 | 2 | 3 | 4 | 5,
      base,
      prices: p,
      events,
      seed: EVENT_EVIDENCE,
      baseReturn: (_from, _to, slice) => {
        const entry = slice.baseEntry ?? {};
        const ws = Object.entries(base).filter(([t]) => entry[t] && p[t]);
        const total = ws.reduce((a, [, w]) => a + w, 0);
        return total > 0 ? ws.reduce((a, [t, w]) => a + (w / total) * (p[t] / entry[t]), 0) - 1 : 0;
      },
    });
    state = step.state as LiveState;
    for (const action of step.actions) {
      const placed = await act(userId, account.id, action, date, p, base, { client, now });
      trades += placed.tradeIds.length;
      count += 1;
      if (action.kind === "enter") {
        const open = state.open.find(
          (s) => s.eventKey === action.slice.eventKey && s.ticker === action.slice.ticker,
        );
        if (open) {
          open.units = placed.units;
          open.baseEntry = Object.fromEntries(
            Object.keys(base).flatMap((t) => (p[t] ? [[t, p[t]]] : [])),
          );
        }
      }
    }
    await db.paperEventOverlays.update({
      where: { id: overlay.id },
      data: {
        lastDate: dateOf(date),
        // Decided events older than the fresh window can't come back: keep the list short.
        state: { ...state, seen: state.seen.slice(-200) } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  // The account is valued at the last closes it holds (loadPaperView): add the funds the overlay
  // trades, at the latest close.
  const latest = closesOn(spine.at(-1)!);
  const stored = await db.paperAccounts.findFirst({ select: { prices: true } });
  await db.paperAccounts.update({
    where: { id: account.id },
    data: { prices: { ...((stored?.prices as Record<string, number>) ?? {}), ...latest } },
  });
  return { ran: true, days: spine.length, trades, actions: count };
}

// One action: its paper trades (each a signal from the events overlay, taken at once, so the
// ledger's own rules and audit apply), and its log row.
async function act(
  userId: string,
  accountId: string,
  action: OverlayAction,
  date: string,
  prices: Record<string, number>,
  base: Record<string, number>,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<{ tradeIds: string[]; units: number }> {
  const db = scopedFor(userId, client);
  const tradeIds: string[] = [];
  let units = 0;
  const event = action.kind === "skip" || action.kind === "enter" ? action.event : null;
  const slice = action.kind === "skip" ? null : action.slice;
  const type = (event?.type ?? slice?.type) as EventTypeId;
  const eventKey = event?.key ?? slice!.eventKey;
  const reason = checked(
    action.kind === "skip"
      ? `${action.event.title}. Not acted on: ${action.why}.`
      : action.kind === "enter"
        ? action.slice.reason
        : `${EVENT_TYPES[type].label}: the slice in ${action.slice.ticker} ${action.kind === "stop" ? `hit its stop (${Math.round(action.slice.fundReturn * 1000) / 10}%)` : "reached its holding time"}, so it is undone at the close on ${date}.`,
    type,
  );

  if (slice) {
    const account = await db.paperAccounts.findFirst({ include: { positions: true } });
    const state = {
      cashCents: account?.cashCents ?? 0,
      positions: Object.fromEntries(
        (account?.positions ?? []).map((p) => [
          p.ticker,
          { quantity: p.quantity, costBasisCents: p.costBasisCents },
        ]),
      ),
    };
    const orders: PaperOrder[] =
      action.kind === "enter"
        ? openOrders(slice, state, prices, base, PAPER_MIN_TRADE_CENTS)
        : closeOrders(slice, state, prices, base, PAPER_MIN_TRADE_CENTS);
    for (const [i, o] of orders.entries()) {
      const signal = await db.paperSignals.create({
        data: {
          accountId,
          userId,
          createdAt: now,
          key: `events:${eventKey}:${slice.ticker}:${action.kind}:${i}`,
          source: "events",
          ticker: o.ticker,
          side: o.side,
          amountCents: o.amountCents,
          priceCents: prices[o.ticker],
          reason,
          confidence: slice.confidence,
          status: "open",
        },
      });
      const taken = await takeSignal(userId, signal.id, { client, now });
      if (!taken.ok) {
        await db.paperSignals.update({
          where: { id: signal.id },
          data: { status: "expired", decidedAt: now },
        });
        continue;
      }
      tradeIds.push(taken.tradeId);
      const fund = slice.side === "trim" ? "BIL" : slice.ticker;
      if (action.kind === "enter" && o.side === "buy" && o.ticker === fund)
        units += o.amountCents / prices[o.ticker];
    }
  }

  await db.paperEventLogs.createMany({
    data: [
      {
        accountId,
        userId,
        at: now,
        date: dateOf(date),
        kind: action.kind,
        eventKey,
        eventType: type,
        eventTitle: event?.title ?? EVENT_TYPES[type].label,
        ticker: slice?.ticker ?? null,
        side: slice?.side ?? null,
        tilt: slice?.tilt ?? null,
        amountCents: null,
        confidence: action.kind === "skip" ? action.confidence : slice!.confidence,
        reason,
        tradeIds,
      },
    ],
    skipDuplicates: true,
  });
  return { tradeIds, units };
}

// Opening the investments page catches up an overlay whose daily run was missed (its last close
// is older than yesterday), or runs it when the page's refresh found new events, after the page is
// sent.
export async function runEventsIfStale(userId: string, options: Options & { news?: boolean } = {}) {
  const now = options.now ?? new Date();
  const client = options.client ?? defaultClient;
  const overlay = await scopedFor(userId, client).paperEventOverlays.findFirst({
    select: { on: true, lastDate: true },
  });
  // No row yet: on by default, and never run.
  if (overlay && !overlay.on) return;
  // Up to date, and no new events since: nothing to do.
  if (!options.news && overlay?.lastDate && dayOf(overlay.lastDate) >= daysBefore(dayOf(now), 1))
    return;
  try {
    await runEventOverlay(userId, options);
  } catch (error) {
    console.error("The events overlay's run failed", { error: String(error) });
  }
}

export class EventsError extends Error {}

// The box's switch: on or off for the person's paper account. On by default; switching back on
// starts from today's events (and those of the last few days), never from older news.
export async function setEventsOverlay(
  userId: string,
  on: boolean,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ on: boolean }> {
  if (!(await adviceMode(userId, { client })))
    throw new EventsError("The events overlay runs on the demo bank only for now.");
  const db = scopedFor(userId, client);
  const account = await db.paperAccounts.findFirst({ select: { id: true } });
  if (!account) throw new EventsError("Start a paper account first.");
  const existing = await db.paperEventOverlays.findFirst({});
  if (existing) {
    await db.paperEventOverlays.update({
      where: { id: existing.id },
      data: on && !existing.on ? { on, switchedAt: now, lastDate: null } : { on },
    });
  } else {
    await db.paperEventOverlays.create({
      data: {
        accountId: account.id,
        userId,
        on,
        switchedAt: now,
        state: emptyOverlay() as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await logAudit(
    { type: "user", id: userId },
    "paper_events_switched",
    { type: "paper_account", id: account.id },
    { on: String(on), simulated: "true" },
  );
  await track(userId, "paper_events_switched", { on });
  return { on };
}
