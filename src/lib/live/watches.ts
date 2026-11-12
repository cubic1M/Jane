import { OPTION_MIN_SAVING_CENTS } from "@/config/compare";
import { LIVE_MATCHES_PER_RUN } from "@/config/detection";
import { STUDENT_PLAN_PRICE_ROOM } from "@/config/life-facts";
import { normalizeAlias } from "@/data-sources/merchant-directory";
import { runDetection } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { log } from "@/lib/log";
import { liveOffers, type LiveOffer } from "@/lib/offers/catalog";
import { systemDb } from "@/lib/system-db";
import { isTrialUser } from "@/lib/trial-ids";
import { recordArrivalsSafely } from "./arrivals";

// Jane's 24/7 engine, step three: reverse matching. Each scan of a person leaves a small index of
// what a market change could help them with (offer_watches): idle cash and what it earns now, and
// the catalog-priced services they pay for and what they pay. When an offer moves, only the people
// watching its target are scanned again, never everyone; whatever that scan finds new arrives
// through the same engine as a bank's change (./arrivals.ts, trigger "offer").

const WHY = "Reverse matching: an offer changed, so the people watching it are found by target";

type Options = { client?: PrismaClient; now?: Date };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const serviceKey = (merchant: string): string | null =>
  normalizeAlias(merchant)?.replace(/\s+/g, "_") ?? null;

// Rebuilds a person's watches from their open findings. Called after every scan of them.
export async function refreshWatches(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<number> {
  // A sample person is never matched to anything (src/lib/trial.ts).
  if (isTrialUser(userId)) return 0;
  const db = scopedFor(userId, client);
  const findings = await db.findings.findMany({
    where: {
      status: { in: ["new", "shown"] },
      type: { in: ["idle_cash", "subscription_review", "price_increase"] },
    },
    select: { type: true, evidence: true },
  });
  const watches = new Map<
    string,
    { idleCents?: number; rateBps?: number; monthlyCents?: number }
  >();
  for (const f of findings) {
    const e = (f.evidence ?? {}) as Record<string, unknown>;
    if (f.type === "idle_cash") {
      const idle = num(e.excessCents);
      const rate = num(e.assumedCurrentRateBps);
      if (idle !== null && rate !== null)
        watches.set("savings", { idleCents: idle, rateBps: rate });
      continue;
    }
    const service = typeof e.merchant === "string" ? serviceKey(e.merchant) : null;
    const paid = num(e.lastAmountCents) ?? (num(e.annualCostCents) ?? 0) / 12;
    // Every service they pay for: a source the catalog adds later reaches them with no rescan.
    if (service && paid > 0) {
      watches.set(`plan:${service}`, { monthlyCents: Math.round(paid) });
    }
  }
  await db.offerWatches.deleteMany({ where: { target: { notIn: [...watches.keys()] } } });
  for (const [target, values] of watches) {
    await db.offerWatches.upsert({
      where: { userId_target: { userId, target } },
      create: { userId, target, ...values },
      update: values,
    });
  }
  return watches.size;
}

export async function refreshWatchesSafely(userId: string, options: Options = {}): Promise<void> {
  await refreshWatches(userId, options).catch((error) =>
    log.error("Refreshing offer watches failed", { error: String(error) }),
  );
}

type Watch = {
  id: string;
  userId: string;
  target: string;
  idleCents: number | null;
  rateBps: number | null;
  monthlyCents: number | null;
  lastMatch: string | null;
};

// Whether an offer helps someone watching it, and the offer it's about.
function helps(watch: Watch, offers: readonly LiveOffer[]): LiveOffer | null {
  if (watch.target === "savings") {
    const best = offers
      .filter(
        (o) =>
          o.kind === "savings_apy" &&
          o.extractedBy !== "seed" &&
          o.valueBps !== null &&
          o.minimumBalanceCents <= (watch.idleCents ?? 0),
      )
      .sort((a, b) => (b.valueBps ?? 0) - (a.valueBps ?? 0))[0];
    if (!best || watch.idleCents === null || watch.rateBps === null) return null;
    const gain = Math.round((watch.idleCents * ((best.valueBps ?? 0) - watch.rateBps)) / 10_000);
    return gain >= OPTION_MIN_SAVING_CENTS ? best : null;
  }
  const service = watch.target.replace(/^plan:/, "");
  const student = offers.find(
    (o) =>
      o.kind === "plan_price" &&
      o.merchantKey === service &&
      o.key.endsWith(".student") &&
      o.extractedBy !== "seed" &&
      o.valueCents !== null,
  );
  // Paying more than the student price (with room for sales tax): the full price.
  if (!student || watch.monthlyCents === null) return null;
  return watch.monthlyCents > (student.valueCents ?? 0) * STUDENT_PLAN_PRICE_ROOM ? student : null;
}

const signature = (o: LiveOffer) => `${o.key}:${o.valueBps ?? o.valueCents}`;

// A person an offer helps: scanned again now, and what that finds arrives as an offer's change.
async function rescan(userId: string, { client, now }: { client: PrismaClient; now: Date }) {
  const detection = await runDetection(userId, { client, now });
  const { scanSuggestions } = await import("@/lib/suggestions");
  await scanSuggestions(userId, { client, now });
  await recordArrivalsSafely(userId, detection.createdKeys, {
    client,
    now,
    trigger: "offer",
    triggerAt: now,
  });
  await refreshWatchesSafely(userId, { client });
}

type MatchResult = { matched: number; left: number };

// Every watch an offer now helps and that hasn't been scanned for that offer and value yet, up to
// LIVE_MATCHES_PER_RUN people a run (the next run takes the rest: nothing is lost, nothing twice).
// Watches are read by target, through its index, never by going through every person.
export async function matchOffers({
  client = defaultClient,
  now = new Date(),
  scan = rescan,
}: Options & { scan?: typeof rescan } = {}): Promise<MatchResult> {
  const offers = await liveOffers({ client, now });
  const targets = [
    ...(offers.some((o) => o.kind === "savings_apy" && o.extractedBy !== "seed")
      ? ["savings"]
      : []),
    ...new Set(
      offers.flatMap((o) =>
        o.kind === "plan_price" && o.merchantKey && o.extractedBy !== "seed"
          ? [`plan:${o.merchantKey}`]
          : [],
      ),
    ),
  ];
  if (targets.length === 0) return { matched: 0, left: 0 };
  const watches = (await systemDb(WHY, client).offerWatch.findMany({
    where: { target: { in: targets } },
    orderBy: { updatedAt: "asc" },
  })) as Watch[];
  const due = watches.flatMap((w) => {
    const offer = helps(w, offers);
    return offer && w.lastMatch !== signature(offer) ? [{ watch: w, offer }] : [];
  });
  const people = [...new Set(due.map((d) => d.watch.userId))];
  const now_ = people.slice(0, LIVE_MATCHES_PER_RUN);
  for (const userId of now_) {
    try {
      await scan(userId, { client, now });
    } catch (error) {
      log.error("Rescanning a person for an offer failed", { error: String(error) });
    }
    for (const { watch, offer } of due.filter((d) => d.watch.userId === userId)) {
      await scopedFor(userId, client).offerWatches.updateMany({
        where: { target: watch.target },
        data: { lastMatch: signature(offer) },
      });
    }
  }
  log.info("offers_matched", { matched: now_.length, left: people.length - now_.length });
  return { matched: now_.length, left: people.length - now_.length };
}
