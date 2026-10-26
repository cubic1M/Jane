import {
  ADDON_KINDS,
  ADDON_LOOKBACK_DAYS,
  ADDON_MIN_CENTS,
  ADDON_MIN_REFUND_CENTS,
  ADDON_RULES,
  AUTO_RATE_FALL_BPS,
  type AddonKind,
} from "@/config/car-loan";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Debt, DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { conciergeMode } from "@/lib/concierge-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { creditBandFor } from "@/lib/credit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { loadRefinance, type Refinance } from "@/lib/refinance";
import {
  addonCandidates,
  cancellationLetter,
  rateChange,
  refundFor,
  type RateChange,
  type Refund,
} from "@/planning/car-loan";

// The car loan you already have (spec step 245). Dealer add-ons financed into the loan (GAP, an
// extended warranty, a service contract) are found in the payments and asked about once; for
// each one the person confirms, the refund a cancellation would give and the letter to cancel,
// to send themselves or to ask the concierge team to send. And the loan itself: the best
// refinance offer compared by total cost, with what changed since the last check (rates fell,
// the score moved into a better band). Estimates from the contract's usual terms; nothing is
// sent by Jane.

type Options = { client?: PrismaClient; now?: Date; book?: DebtBook; refinance?: Refinance };

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const BAND_ORDER = ["excellent", "good", "fair"] as const;

export class CarLoanError extends Error {}

export type AddonView = {
  id: string | null;
  key: string;
  kind: AddonKind;
  label: string;
  name: string;
  paidCents: number;
  termMonths: number;
  startedOn: string;
  status: string;
  refund: Refund;
  worthCancelling: boolean;
  letter: string | null;
};

export type CarLoan = {
  available: boolean;
  advice: boolean;
  // Read-only mode: whether the team can send a cancellation for them (the demo bank only).
  team: boolean;
  loan: {
    key: string;
    name: string;
    balanceCents: number;
    aprBps: number | null;
    monthlyCents: number | null;
  } | null;
  refi: {
    lender: string;
    aprBps: number;
    rateType: string;
    currentTotalCents: number;
    newTotalCents: number;
    savingCents: number;
    feeCents: number;
    monthlyCents: number;
    currentMonthlyCents: number;
    breakEvenMonths: number | null;
    checkedOn: string | null;
  } | null;
  change: { kind: RateChange; on: string } | null;
  // Found in the payments, not yet asked about.
  candidates: AddonView[];
  // Confirmed, with the refund and the letter.
  addons: AddonView[];
};

const none: CarLoan = {
  available: false,
  advice: false,
  team: false,
  loan: null,
  refi: null,
  change: null,
  candidates: [],
  addons: [],
};

function view(
  name: string,
  a: {
    id: string | null;
    key: string;
    kind: AddonKind;
    name: string;
    paidCents: number;
    termMonths: number;
    startedOn: string;
    status: string;
  },
  today: string,
): AddonView {
  const refund = refundFor({
    kind: a.kind,
    paidCents: a.paidCents,
    termMonths: a.termMonths,
    startedOn: a.startedOn,
    today,
  });
  return {
    ...a,
    label: ADDON_RULES[a.kind].label,
    refund,
    worthCancelling: refund.refundCents >= ADDON_MIN_REFUND_CENTS,
    letter: ["confirmed", "mine", "team"].includes(a.status)
      ? cancellationLetter({
          name,
          kind: a.kind,
          addonName: a.name,
          paidCents: a.paidCents,
          startedOn: a.startedOn,
          termMonths: a.termMonths,
          refund,
        })
      : null,
  };
}

const autoLoanOf = (book: DebtBook): Debt | undefined =>
  [...book.debts]
    .filter((d) => d.kind === "auto" && (d.balanceCents ?? 0) > 0)
    .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))[0];

export async function loadCarLoan(
  userId: string,
  { client = defaultClient, now = new Date(), book: given, refinance: givenRefi }: Options = {},
): Promise<CarLoan> {
  const book = await debtsOr(given, userId, { client, now });
  const loan = autoLoanOf(book);
  if (!loan) return none;
  const db = scopedFor(userId, client);
  const asOf = isoDay(now);
  const since = new Date(now.getTime() - ADDON_LOOKBACK_DAYS * DAY_MS);
  const [rows, txs, user, refinance, watch, advice, team] = await Promise.all([
    db.carAddons.findMany({ orderBy: { startedOn: "desc" } }),
    db.transactions.findMany({
      where: {
        date: { gte: since },
        pending: false,
        amountCents: { gte: ADDON_MIN_CENTS },
        OR: ["gap", "guaranteed asset", "warranty", "service contract", "maintenance plan"].map(
          (w) => ({ description: { contains: w, mode: "insensitive" as const } }),
        ),
      },
      select: { id: true, date: true, amountCents: true, description: true, merchantName: true },
      orderBy: { date: "desc" },
    }),
    client.user.findUnique({ where: { id: userId }, select: { name: true } }),
    givenRefi ?? loadRefinance(userId, { client, now, book }),
    db.carLoanWatches.findFirst(),
    adviceMode(userId, { client }),
    conciergeMode(userId, { client }),
  ]);
  const name = user?.name ?? "";
  const taken = new Set(rows.map((r) => r.key));
  const candidates = addonCandidates(txs.map((t) => ({ ...t, date: isoDay(t.date) })))
    .filter((c) => !taken.has(c.key))
    .map((c) =>
      view(
        name,
        { ...c, id: null, termMonths: ADDON_RULES[c.kind].defaultTermMonths, status: "found" },
        asOf,
      ),
    );
  const addons = rows
    .filter((r) => r.status !== "dismissed" && r.status !== "found")
    .map((r) =>
      view(
        name,
        {
          id: r.id,
          key: r.key,
          kind: r.kind as AddonKind,
          name: r.name,
          paidCents: r.paidCents,
          termMonths: r.termMonths,
          startedOn: isoDay(r.startedOn),
          status: r.status,
        },
        asOf,
      ),
    );
  const comparison = refinance.comparisons.find((c) => c.debtKey === loan.key);
  const best = comparison?.pick ?? comparison?.offers[0] ?? null;
  return {
    available: true,
    advice,
    team,
    loan: {
      key: loan.key,
      name: loan.name,
      balanceCents: loan.balanceCents!,
      aprBps: loan.aprBps,
      monthlyCents: loan.paymentCents,
    },
    refi:
      comparison && best
        ? {
            lender: best.offer.lender,
            aprBps: best.offer.aprBps,
            rateType: best.offer.rateType,
            currentTotalCents: comparison.currentTotalCents,
            newTotalCents: best.totalCents,
            savingCents: best.savingCents,
            feeCents: best.offer.feeCents,
            monthlyCents: best.monthlyCents,
            currentMonthlyCents: comparison.currentMonthlyCents,
            breakEvenMonths: best.breakEvenMonths,
            checkedOn: refinance.checkedOn,
          }
        : null,
    change:
      watch?.change && watch.changedOn
        ? { kind: watch.change as RateChange, on: isoDay(watch.changedOn) }
        : null,
    candidates,
    addons,
  };
}

const check = (n: unknown, min: number, max: number, what: string): number => {
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new CarLoanError(`${what} should be between ${min} and ${max}.`);
  }
  return n;
};

// The person said a payment found in their accounts was a dealer add-on, over this many months.
export async function confirmAddon(
  userId: string,
  key: string,
  { termMonths }: { termMonths?: number } = {},
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<AddonView> {
  const data = await loadCarLoan(userId, { client, now });
  const c = data.candidates.find((x) => x.key === key);
  if (!c) throw new CarLoanError("That payment isn't on your list any more.");
  const term = check(termMonths ?? c.termMonths, 1, 120, "The term in months");
  const row = await scopedFor(userId, client).carAddons.create({
    data: {
      userId,
      key: c.key,
      kind: c.kind,
      name: c.name,
      paidCents: c.paidCents,
      termMonths: term,
      startedOn: new Date(`${c.startedOn}T00:00:00Z`),
      status: "confirmed",
      source: "detected",
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "car_addon_confirmed",
    { type: "car_addon", id: row.id },
    { kind: c.kind },
  );
  await track(userId, "car_addon_confirmed", { kind: c.kind });
  const after = await loadCarLoan(userId, { client, now });
  return after.addons.find((a) => a.id === row.id)!;
}

export async function dismissAddon(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const data = await loadCarLoan(userId, { client, now });
  const c = data.candidates.find((x) => x.key === key);
  if (!c) throw new CarLoanError("That payment isn't on your list any more.");
  await scopedFor(userId, client).carAddons.create({
    data: {
      userId,
      key: c.key,
      kind: c.kind,
      name: c.name,
      paidCents: c.paidCents,
      termMonths: c.termMonths,
      startedOn: new Date(`${c.startedOn}T00:00:00Z`),
      status: "dismissed",
      source: "detected",
    },
  });
}

export async function addTypedAddon(
  userId: string,
  input: { kind: string; name: string; paidCents: number; termMonths: number; startedOn: string },
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (!(ADDON_KINDS as readonly string[]).includes(input.kind)) {
    throw new CarLoanError("Pick GAP, an extended warranty or a service contract.");
  }
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new CarLoanError("Say who sold it, like the dealer's name.");
  check(input.paidCents, 1_000, 100_000_00, "The price");
  check(input.termMonths, 1, 120, "The term in months");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startedOn) || input.startedOn > isoDay(now)) {
    throw new CarLoanError("Give the day you bought it, not in the future.");
  }
  const db = scopedFor(userId, client);
  const row = await db.carAddons.create({
    data: {
      userId,
      key: `typed:${crypto.randomUUID()}`,
      kind: input.kind,
      name,
      paidCents: input.paidCents,
      termMonths: input.termMonths,
      startedOn: new Date(`${input.startedOn}T00:00:00Z`),
      status: "confirmed",
      source: "typed",
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "car_addon_confirmed",
    { type: "car_addon", id: row.id },
    { kind: input.kind },
  );
}

// The person will send the cancellation themselves, or asks the concierge team to send it.
export async function requestCancellation(
  userId: string,
  addonId: string,
  by: "mine" | "team",
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const row = await db.carAddons.findFirst({ where: { id: addonId } });
  if (!row || row.status !== "confirmed") {
    throw new CarLoanError("That add-on isn't waiting on a cancellation.");
  }
  // Read-only mode: nobody sends anything for a real account.
  if (by === "team" && !(await conciergeMode(userId, { client }))) {
    throw new CarLoanError("Jane can't send it for you. Copy the letter and send it yourself.");
  }
  await db.carAddons.updateMany({ where: { id: addonId }, data: { status: by } });
  await logAudit(
    { type: "user", id: userId },
    "car_addon_cancel_requested",
    { type: "car_addon", id: addonId },
    { by, kind: row.kind },
  );
  await track(userId, "car_addon_cancel_requested", { by });
}

// Jane's monthly look (src/lib/debt-refresh.ts): the best offer's rate and the credit band now
// against the last check's, so a fall in rates or a better score is noticed once.
export async function refreshCarLoan(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RateChange | null> {
  const book = await debtsOr(undefined, userId, { client, now });
  const loan = autoLoanOf(book);
  if (!loan) return null;
  const db = scopedFor(userId, client);
  const [refinance, band, watch] = await Promise.all([
    loadRefinance(userId, { client, now, book }),
    creditBandFor(userId, { client }),
    db.carLoanWatches.findFirst(),
  ]);
  if (!refinance.available) return null;
  const offers = refinance.comparisons.find((c) => c.debtKey === loan.key)?.offers ?? [];
  const bestAprBps = offers.length ? Math.min(...offers.map((o) => o.offer.aprBps)) : null;
  const change = rateChange({
    lastBestAprBps: watch?.bestAprBps ?? null,
    bestAprBps,
    lastBand: watch?.band ?? null,
    band,
    bandOrder: BAND_ORDER,
    fallBps: AUTO_RATE_FALL_BPS,
  });
  const today = new Date(`${isoDay(now)}T00:00:00Z`);
  const data = {
    bestAprBps,
    band,
    checkedOn: today,
    ...(change ? { change, changedOn: today } : {}),
  };
  await db.carLoanWatches.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return change;
}
