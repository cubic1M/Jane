import {
  OFFER_SEED_SHOW_DAYS,
  OFFER_SEEDS,
  OFFER_SOURCES,
  OFFERS_CLAUDE_MAX_TOKENS,
  OFFERS_CLAUDE_MONTHLY_CALLS,
  OFFERS_CLAUDE_PAGE_CHARS,
  OFFERS_RECHECK_HOURS,
  OFFERS_RUN_BUDGET_MS,
  type OfferKind,
  type OfferSpec,
  type SourceSpec,
} from "@/config/offers";
import type { MarketOffer, Prisma, PrismaClient } from "@/generated/prisma/client";
import { anthropic, finishedText, llmEnabled } from "@/lib/anthropic";
import { db as defaultClient } from "@/lib/db";
import { alertError } from "@/lib/error-alerts";
import { log } from "@/lib/log";
import { systemDb } from "@/lib/system-db";
import { UNTRUSTED_TEXT_RULE } from "@/lib/untrusted-text";
import { politeFetch, type Fetcher } from "./fetch";
import {
  fingerprintOf,
  pageText,
  readFdicNational,
  readFredSeries,
  readPlanPrices,
  readSavingsApy,
  readTreasuryBills,
  type Readings,
} from "./parse";

// Jane's offers catalog: the market's options and figures, read from official APIs and providers'
// own pages on each source's cadence (src/config/offers.ts), checked before they're used, and never
// shown once past their time or quarantined. Code does the money: a reader or Claude only says
// what a page states, and a reading is used only inside its plausible range and close to the last
// one. A reading that isn't is quarantined and the founders hear about it.

const WHY = "The offers catalog is shared market data, no one's own";
const DAY_MS = 24 * 60 * 60 * 1000;
// Events kept this long, then pruned by the refresher.
const EVENT_DAYS = 90;

type Options = { client?: PrismaClient; now?: Date };
export type Extractor = (text: string, wanted: readonly OfferSpec[]) => Promise<Readings | null>;
type RefreshOptions = Options & { fetcher?: Fetcher; extract?: Extractor | null };

export type LiveOffer = Pick<
  MarketOffer,
  | "key"
  | "source"
  | "kind"
  | "provider"
  | "name"
  | "valueBps"
  | "valueCents"
  | "minimumBalanceCents"
  | "merchantKey"
  | "sourceUrl"
  | "signUpUrl"
  | "checkedAt"
  | "extractedBy"
>;

// The figures still allowed to be shown: live and inside their time.
export async function liveOffers({
  client = defaultClient,
  now = new Date(),
  kind,
}: Options & { kind?: OfferKind } = {}): Promise<LiveOffer[]> {
  return systemDb(WHY, client).marketOffer.findMany({
    where: { status: "live", expiresAt: { gt: now }, ...(kind ? { kind } : {}) },
    orderBy: { key: "asc" },
    select: {
      key: true,
      source: true,
      kind: true,
      provider: true,
      name: true,
      valueBps: true,
      valueCents: true,
      minimumBalanceCents: true,
      merchantKey: true,
      sourceUrl: true,
      signUpUrl: true,
      checkedAt: true,
      extractedBy: true,
    },
  });
}

// The hand-kept figures as the catalog's first rows, once (src/config/offers.ts OFFER_SEEDS).
export async function seedOffers({ client = defaultClient }: Options = {}): Promise<number> {
  const { count } = await systemDb(WHY, client).marketOffer.createMany({
    data: OFFER_SEEDS.filter((s) => s.valueBps !== undefined || s.valueCents !== undefined).map(
      (s) => {
        const checkedAt = new Date(`${s.checkedOn}T00:00:00Z`);
        return {
          key: s.key,
          source: s.source,
          kind: s.kind,
          provider: s.provider,
          name: s.name,
          valueBps: s.valueBps ?? null,
          valueCents: s.valueCents ?? null,
          merchantKey: s.merchantKey ?? null,
          sourceUrl: s.sourceUrl,
          checkedAt,
          expiresAt: new Date(checkedAt.getTime() + OFFER_SEED_SHOW_DAYS * DAY_MS),
          extractedBy: "seed",
          changedAt: checkedAt,
        };
      },
    ),
    skipDuplicates: true,
  });
  return count;
}

// What one source says now, by its own reader.
async function readSource(
  source: SourceSpec,
  fetcher: Fetcher | undefined,
): Promise<{ readings: Readings; html: string | null }> {
  if (source.key === "treasury.bills") {
    return {
      readings: readTreasuryBills(
        JSON.parse(await politeFetch(source.url, { fetcher, page: false })),
      ),
      html: null,
    };
  }
  if (source.key === "fred.rates") {
    const readings: Readings = {};
    for (const offer of source.offers) {
      const id = offer.key.replace(/^fred\./, "");
      const url = `${source.url}?series_id=${id}&api_key=${process.env.FRED_API_KEY}&file_type=json&sort_order=asc&observation_start=${new Date(Date.now() - 120 * DAY_MS).toISOString().slice(0, 10)}`;
      const value = readFredSeries(JSON.parse(await politeFetch(url, { fetcher, page: false })));
      if (value !== null) readings[offer.key] = value;
    }
    return { readings, html: null };
  }
  const html = await politeFetch(source.url, { fetcher });
  if (source.key === "fdic.national") return { readings: readFdicNational(html), html };
  const [first] = source.offers;
  if (first?.kind === "savings_apy") return { readings: readSavingsApy(html, first.key), html };
  if (first?.kind === "plan_price" && first.merchantKey) {
    return { readings: readPlanPrices(html, first.merchantKey), html };
  }
  return { readings: {}, html };
}

const valueOf = (row: Pick<MarketOffer, "valueBps" | "valueCents">) =>
  row.valueBps ?? row.valueCents;
const isRate = (kind: string) => kind !== "plan_price";

// Whether a reading may be used: inside its range, and (against a real earlier reading) not a jump.
function checkReading(
  offer: OfferSpec,
  value: number,
  last: Pick<MarketOffer, "valueBps" | "valueCents" | "extractedBy" | "status"> | null,
): "ok" | "implausible" | "jump" {
  if (!Number.isFinite(value) || value < offer.plausible[0] || value > offer.plausible[1]) {
    return "implausible";
  }
  const before = last ? valueOf(last) : null;
  if (
    last &&
    last.extractedBy !== "seed" &&
    before !== null &&
    Math.abs(value - before) > offer.maxJump
  ) {
    return "jump";
  }
  return "ok";
}

async function claudeCallsThisMonth(client: PrismaClient, now: Date): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return systemDb(WHY, client).marketOfferEvent.count({
    where: { kind: "claude", createdAt: { gte: monthStart } },
  });
}

// Claude reads the page only where the source's own reader missed: the cheapest model, the
// page's words only, numbers it states or null. Off unless OFFERS_CLAUDE_MODEL is set.
function claudeExtractor(): Extractor | null {
  const model = process.env.OFFERS_CLAUDE_MODEL;
  if (!model || !llmEnabled()) return null;
  return async (text, wanted) => {
    const response = await anthropic().messages.create({
      model,
      max_tokens: OFFERS_CLAUDE_MAX_TOKENS,
      system: `You read a company's public web page and report figures it states. Answer with JSON only: an object whose keys are the ids asked for and whose values are the number the page states (a percent like 4.10, or a monthly price in dollars like 6.99), or null when the page doesn't state it. Never estimate.

${UNTRUSTED_TEXT_RULE}`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            want: wanted.map((o) => ({
              id: o.key,
              what: `${o.name}: ${isRate(o.kind) ? "annual percentage yield, percent" : "price per month, US dollars"}`,
            })),
            page: text.slice(0, OFFERS_CLAUDE_PAGE_CHARS),
          }),
        },
      ],
    });
    const answer = finishedText(response);
    const parsed = JSON.parse(answer?.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Record<string, unknown>;
    const out: Readings = {};
    for (const offer of wanted) {
      const v = parsed[offer.key];
      if (typeof v === "number" && Number.isFinite(v)) out[offer.key] = Math.round(v * 100);
    }
    return out;
  };
}

export type SourceResult = {
  source: string;
  changed: string[];
  quarantined: string[];
  missing: string[];
};

// Reads one source and saves what it says. Never throws for a source that failed: that's an event.
export async function refreshSource(
  source: SourceSpec,
  {
    client = defaultClient,
    now = new Date(),
    fetcher,
    extract = claudeExtractor(),
  }: RefreshOptions = {},
): Promise<SourceResult> {
  const sys = systemDb(WHY, client);
  const result: SourceResult = { source: source.key, changed: [], quarantined: [], missing: [] };
  const event = (kind: string, offerKey: string | null, detail: Record<string, unknown>) =>
    sys.marketOfferEvent.create({
      data: {
        source: source.key,
        offerKey,
        kind,
        detail: detail as Prisma.InputJsonObject,
        createdAt: now,
      },
    });
  let read: { readings: Readings; html: string | null };
  try {
    read = await readSource(source, fetcher);
  } catch (error) {
    await event("failed", null, {
      reason: error instanceof Error ? error.message.slice(0, 80) : "error",
    });
    return { ...result, missing: source.offers.map((o) => o.key) };
  }
  const rows = await sys.marketOffer.findMany({
    where: { key: { in: source.offers.map((o) => o.key) } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const fingerprint = read.html ? fingerprintOf(read.html) : null;
  const readings: Record<string, { value: number; by: string }> = {};
  for (const [key, value] of Object.entries(read.readings)) {
    readings[key] = { value, by: source.how === "api" ? "api" : "parser" };
  }

  // The reader missed some: Claude may try, once per changed page, under the month's cap.
  const missed = source.offers.filter((o) => !(o.key in readings));
  const changedPage =
    fingerprint !== null && missed.some((o) => byKey.get(o.key)?.fingerprint !== fingerprint);
  if (missed.length > 0 && changedPage && extract && read.html) {
    if ((await claudeCallsThisMonth(client, now)) < OFFERS_CLAUDE_MONTHLY_CALLS) {
      await event("claude", null, { offers: missed.map((o) => o.key) });
      const found = await extract(pageText(read.html), missed).catch(() => null);
      for (const [key, value] of Object.entries(found ?? {}))
        readings[key] = { value, by: "claude" };
    }
  }

  for (const offer of source.offers) {
    const last = byKey.get(offer.key) ?? null;
    const reading = readings[offer.key];
    if (!reading) {
      result.missing.push(offer.key);
      await event("failed", offer.key, { reason: "not_found" });
      continue;
    }
    const verdict = checkReading(offer, reading.value, last);
    if (verdict !== "ok") {
      result.quarantined.push(offer.key);
      await event("quarantined", offer.key, {
        reason: verdict,
        before: last ? valueOf(last) : null,
        after: reading.value,
        by: reading.by,
      });
      if (last && last.status !== "quarantined") {
        await sys.marketOffer.update({
          where: { key: offer.key },
          data: { status: "quarantined" },
        });
      }
      // Once, when it goes into quarantine: a person checks the page and the reader.
      if (last?.status !== "quarantined") {
        await alertError(
          {
            message: `OfferQuarantined: ${offer.key} read ${reading.value} (${verdict})`,
            path: "/api/cron/offers",
          },
          { client, now },
        ).catch(() => undefined);
      }
      continue;
    }
    const value = isRate(offer.kind) ? { valueBps: reading.value } : { valueCents: reading.value };
    const moved = !last || valueOf(last) !== reading.value || last.status !== "live";
    const common = {
      source: source.key,
      kind: offer.kind,
      provider: offer.provider,
      name: offer.name,
      ...value,
      minimumBalanceCents: offer.minimumBalanceCents ?? 0,
      merchantKey: offer.merchantKey ?? null,
      sourceUrl: source.sourceUrl,
      signUpUrl: offer.signUpUrl ?? null,
      checkedAt: now,
      expiresAt: new Date(now.getTime() + source.showHours * 3_600_000),
      status: "live",
      extractedBy: reading.by,
      fingerprint,
      ...(moved ? { changedAt: now } : {}),
    };
    await sys.marketOffer.upsert({
      where: { key: offer.key },
      create: { key: offer.key, ...common, changedAt: now },
      update: common,
    });
    if (moved) {
      result.changed.push(offer.key);
      await event(last ? "changed" : "new", offer.key, {
        before: last ? valueOf(last) : null,
        after: reading.value,
        by: reading.by,
      });
    }
  }
  return result;
}

// When each source was last read (its last event of any kind).
async function lastRead(client: PrismaClient): Promise<Map<string, Date>> {
  const rows = await systemDb(WHY, client).marketOfferEvent.groupBy({
    by: ["source"],
    _max: { createdAt: true },
  });
  return new Map(rows.flatMap((r) => (r._max.createdAt ? [[r.source, r._max.createdAt]] : [])));
}

// Every source whose time has come, within the run's budget. The hourly call and the daily backstop
// both come here; a source read recently is left alone, so calling it more often costs nothing.
export async function refreshDueOffers({
  client = defaultClient,
  now = new Date(),
  fetcher,
  extract,
  budgetMs = OFFERS_RUN_BUDGET_MS,
}: RefreshOptions & { budgetMs?: number } = {}): Promise<SourceResult[]> {
  const started = Date.now();
  await seedOffers({ client });
  const last = await lastRead(client);
  const results: SourceResult[] = [];
  for (const source of OFFER_SOURCES) {
    if (Date.now() - started > budgetMs) break;
    if (source.needsEnv && !process.env[source.needsEnv]) continue;
    const at = last.get(source.key);
    if (at && now.getTime() - at.getTime() < source.everyMinutes * 60_000) continue;
    const result = await refreshSource(source, {
      client,
      now,
      fetcher,
      ...(extract !== undefined ? { extract } : {}),
    });
    // A source that read nothing at all still counts as read, so it isn't tried every hour.
    if (result.changed.length === 0) {
      await systemDb(WHY, client).marketOfferEvent.create({
        data: {
          source: source.key,
          kind: "checked",
          detail: { missing: result.missing.length },
          createdAt: now,
        },
      });
    }
    results.push(result);
  }
  await systemDb(WHY, client).marketOfferEvent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - EVENT_DAYS * DAY_MS) } },
  });
  for (const r of results) {
    log.info("offers_refreshed", {
      source: r.source,
      changed: r.changed.length,
      quarantined: r.quarantined.length,
      missing: r.missing.length,
    });
  }
  return results;
}

// A person's own charge for a service just changed: its prices are read again first when the
// catalog's are older than OFFERS_RECHECK_HOURS, so what Jane compares with is today's.
export async function recheckPlanPrices(
  merchantKey: string,
  options: RefreshOptions = {},
): Promise<SourceResult | null> {
  const { client = defaultClient, now = new Date() } = options;
  const source = OFFER_SOURCES.find((s) => s.offers.some((o) => o.merchantKey === merchantKey));
  if (!source) return null;
  const freshest = await systemDb(WHY, client).marketOffer.findFirst({
    where: { source: source.key, status: "live" },
    orderBy: { checkedAt: "desc" },
    select: { checkedAt: true },
  });
  if (freshest && now.getTime() - freshest.checkedAt.getTime() < OFFERS_RECHECK_HOURS * 3_600_000) {
    return null;
  }
  return refreshSource(source, options);
}
