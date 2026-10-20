import type { CryptoConnectionKind } from "@/config/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { demoAnchorFor } from "@/lib/plaid/demo";
import { DEMO_CRYPTO_PARTNER, demoCryptoSource, type CryptoSource } from "@/lib/crypto/source";
import {
  lotsAndSales,
  salesIn,
  totals,
  unrealised,
  type Sale,
  type Trade,
} from "@/planning/crypto-tax";
import {
  esppSale,
  isoExercise,
  type EsppResult,
  type Event,
  type IsoResult,
} from "@/planning/equity-tax";

// Crypto and equity pay as income for a tax year (spec step 219): crypto sales by lot, ESPP
// sales, ISO exercises. Kept apart from the estimate's own loader so the estimate can use
// it without a cycle; the person's view of it is in ./equity-tax.ts.

type Options = { client?: PrismaClient; now?: Date; source?: CryptoSource | null };

const iso = (d: Date) => d.toISOString().slice(0, 10);
// How far back the exchange's trades are read to build lots.
const HISTORY_YEARS = 5;

export type CryptoHoldingTax = {
  asset: string;
  connection: string;
  quantity: number;
  valueCents: number;
  basisCents: number;
  gainCents: number;
  shortTermCents: number;
  longTermCents: number;
};

export type EquityIncome = {
  year: number;
  crypto: {
    holdings: CryptoHoldingTax[];
    sales: Sale[];
    // Sales in the year.
    yearSales: Sale[];
    // Exchanges that sold something in the year (for the 1099-DA).
    exchangesSold: { name: string; proceedsCents: number; costCents: number }[];
  };
  events: {
    event: Event & { id: string };
    espp: EsppResult | null;
    iso: IsoResult | null;
  }[];
  // What goes into the estimate.
  shortTermGainsCents: number;
  longTermGainsCents: number;
  ordinaryCents: number;
  amtPreferenceCents: number;
};

export const toEvent = (r: {
  kind: string;
  company: string;
  shares: number;
  occurredOn: Date;
  grantedOn: Date | null;
  priceCents: number;
  fmvCents: number;
  withheldCents: number | null;
  soldOn: Date | null;
  soldPriceCents: number | null;
  grantDiscountCents: number | null;
}): Event => ({
  kind: r.kind as Event["kind"],
  company: r.company,
  shares: r.shares,
  occurredOn: iso(r.occurredOn),
  grantedOn: r.grantedOn ? iso(r.grantedOn) : null,
  priceCents: r.priceCents,
  fmvCents: r.fmvCents,
  withheldCents: r.withheldCents,
  soldOn: r.soldOn ? iso(r.soldOn) : null,
  soldPriceCents: r.soldPriceCents,
  grantDiscountCents: r.grantDiscountCents,
});

export async function loadEquityIncome(
  userId: string,
  year: number,
  { client = defaultClient, now = new Date(), source }: Options = {},
): Promise<EquityIncome> {
  const db = scopedFor(userId, client);
  const today = iso(now);
  const [rows, connections] = await Promise.all([
    db.equityEvents.findMany({ orderBy: [{ occurredOn: "asc" }, { id: "asc" }] }),
    db.cryptoConnections.findMany({
      where: { kind: "exchange" },
      select: { id: true, name: true, kind: true, partner: true, address: true, holdings: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);

  // Crypto: each exchange's trades become lots; the holdings left are valued against them.
  let src = source;
  if (src === undefined) {
    const anchor = await demoAnchorFor(userId, { client });
    src =
      connections.some((c) => c.partner === DEMO_CRYPTO_PARTNER) && anchor
        ? demoCryptoSource(anchor)
        : null;
  }
  const holdings: CryptoHoldingTax[] = [];
  const sales: Sale[] = [];
  const exchangesSold: EquityIncome["crypto"]["exchangesSold"] = [];
  for (const c of connections) {
    if (!src) continue;
    const trades = (
      await src.trades(
        { kind: c.kind as CryptoConnectionKind, partner: c.partner, address: c.address },
        `${year - HISTORY_YEARS}-01-01`,
        today,
      )
    )
      .filter((t) => t.quantity !== undefined && t.quantity > 0)
      .map((t): Trade => ({
        date: t.date,
        asset: t.asset,
        side: t.side,
        quantity: t.quantity!,
        // A buy costs what was paid plus the fee; a sale brings in what's left after it.
        cents: t.side === "buy" ? t.amountCents + t.feeCents : t.amountCents - t.feeCents,
      }));
    const mine: Sale[] = [];
    for (const h of c.holdings) {
      const { left, sales: s } = lotsAndSales(h.asset, trades, h.quantity, h.costBasisCents);
      mine.push(...s);
      const u = unrealised(h.valueCents, left, today);
      holdings.push({
        asset: h.asset,
        connection: c.name,
        quantity: h.quantity,
        valueCents: h.valueCents,
        basisCents: u.basisCents,
        gainCents: u.gainCents,
        shortTermCents: u.shortTermCents,
        longTermCents: u.longTermCents,
      });
    }
    // Assets sold out entirely have no holding row: their sales still count.
    const assets = new Set(c.holdings.map((h) => h.asset));
    for (const asset of new Set(trades.map((t) => t.asset))) {
      if (!assets.has(asset)) mine.push(...lotsAndSales(asset, trades, 0, null).sales);
    }
    sales.push(...mine);
    const inYear = salesIn(mine, year);
    if (inYear.length > 0) {
      const t = totals(inYear);
      exchangesSold.push({ name: c.name, proceedsCents: t.proceedsCents, costCents: t.costCents });
    }
  }
  const yearSales = salesIn(sales, year);
  const crypto = totals(yearSales);

  // Equity pay events.
  let shortTerm = crypto.shortTermCents;
  let longTerm = crypto.longTermCents;
  let ordinary = 0;
  let preference = 0;
  const events: EquityIncome["events"] = rows.map((r) => {
    const event = { ...toEvent(r), id: r.id };
    const espp = esppSale(event);
    const exercise = isoExercise(event, year);
    if (espp && event.soldOn?.startsWith(String(year))) {
      ordinary += espp.ordinaryCents;
      if (espp.longTerm) longTerm += espp.gainCents;
      else shortTerm += espp.gainCents;
    }
    if (exercise) {
      preference += exercise.preferenceCents;
      ordinary += exercise.ordinaryCents;
      shortTerm += exercise.gainCents;
    }
    return { event, espp, iso: exercise };
  });
  return {
    year,
    crypto: { holdings, sales, yearSales, exchangesSold },
    events,
    shortTermGainsCents: shortTerm,
    longTermGainsCents: longTerm,
    ordinaryCents: ordinary,
    amtPreferenceCents: preference,
  };
}
