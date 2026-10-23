import { COSTLY_CREEP_MIN_CENTS } from "@/config/costly-borrowing";
import {
  MONTHLY_ITEM_TITLES,
  MONTHLY_REFI_KINDS,
  type MonthlyItemKey,
} from "@/config/credit-monthly";
import { FIT_MIN_SAVING_CENTS } from "@/config/fit";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import { adviceMode } from "@/lib/advice-mode";
import { loadBorrowingPower, type BorrowingPower } from "@/lib/borrowing-power";
import { loadCarLoan, type CarLoan } from "@/lib/car-loan";
import { askNextRateHerself, loadCardInterest, type CardInterest } from "@/lib/card-interest";
import { loadCostlyBorrowing, type CostlyBorrowing } from "@/lib/costly-borrowing";
import { dayLabel } from "@/lib/day-label";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { loadFit } from "@/lib/fit";
import { formatCents } from "@/lib/money";
import { loadRefinance } from "@/lib/refinance";
import { loadRenting, type Renting } from "@/lib/renting";
import { autopilotFor } from "@/lib/sector-autopilot";
import { upsertOnce } from "@/lib/unique-race";
import { rateStep } from "@/planning/card-interest";

// Credit on autopilot, round three (spec step 251): every month, after her soft checks, Jane
// goes over borrowing in one pass: a cheaper rate on each loan (the fit engine's pick, the same
// as the loan options card), car loan add-ons worth cancelling, costly borrowing creeping back,
// and the rent and deposit dates. Within the debt caps she does what is free and safe herself
// (the soft checks at every level; at Handle everything, the next lower-rate request to a card);
// the rest is one message with a button per item. Nothing that runs a hard pull, opens an
// account, applies for credit or cancels cover happens here without a tap.

type Parts = {
  carLoan?: CarLoan;
  costly?: CostlyBorrowing;
  renting?: Renting;
  borrowing?: BorrowingPower;
  cardInterest?: CardInterest;
};
type Options = { client?: PrismaClient; now?: Date; book?: DebtBook; parts?: Parts };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type MonthlyItem = {
  key: MonthlyItemKey;
  title: string;
  // done: Jane did it; tap: it waits for the person; ok: checked, nothing to do.
  status: "done" | "tap" | "ok";
  text: string;
  // Where the person acts: a page with the button (applying, cancelling, sending).
  link?: { href: string; label: string };
};

export type CreditMonthly = {
  available: boolean;
  advice: boolean;
  level: "ask" | "safe" | "all";
  // The month this is for (YYYY-MM), and the day Jane did it (null: worked out now, on asking).
  month: string;
  checkedOn: string | null;
  items: MonthlyItem[];
  // What Jane did by herself in it.
  did: string[];
};

const item = (
  key: MonthlyItemKey,
  status: MonthlyItem["status"],
  text: string,
  link?: MonthlyItem["link"],
): MonthlyItem => ({ key, title: MONTHLY_ITEM_TITLES[key], status, text, link });

function softChecksItem(checkedOn: string | null, borrowing: BorrowingPower): MonthlyItem {
  const on = [checkedOn, borrowing.checkedOn].filter((d): d is string => d !== null).sort()[0];
  if (!on) {
    return item(
      "soft_checks",
      "ok",
      "No lending partner for your accounts yet, so nothing to check.",
    );
  }
  const moved = borrowing.changes[0] ? ` ${borrowing.changes[0]}` : "";
  return item(
    "soft_checks",
    "done",
    `I soft-checked your loan rates and what you could borrow on ${dayLabel(on)}; soft checks never touch your score.${moved}`,
    borrowing.changes.length > 0
      ? { href: "/loans/borrow", label: "What you could borrow" }
      : undefined,
  );
}

async function ratesItem(
  userId: string,
  book: DebtBook,
  client: PrismaClient,
  now: Date,
): Promise<MonthlyItem> {
  const loans = book.debts.filter(
    (d) =>
      (MONTHLY_REFI_KINDS as readonly string[]).includes(d.kind) &&
      (d.balanceCents ?? 0) > 0 &&
      d.aprBps !== null,
  );
  const picks: { name: string; lender: string; aprBps: number; savesCents: number }[] = [];
  for (const loan of loans) {
    const view = await loadFit(userId, { need: "refinance", debtKey: loan.key }, { client, now });
    const pick = view.options.find((o) => o.id === view.pick);
    if (
      pick &&
      pick.id !== "keep" &&
      pick.id !== "payoff" &&
      (pick.savesCents ?? 0) >= FIT_MIN_SAVING_CENTS
    ) {
      picks.push({
        name: loan.name,
        lender: pick.lender,
        aprBps: pick.aprBps,
        savesCents: pick.savesCents!,
      });
    }
  }
  if (picks.length === 0) {
    return item(
      "rates",
      "ok",
      loans.length === 0
        ? "No loan to refinance."
        : "No loan has a cheaper rate worth moving for, fees counted.",
    );
  }
  const best = picks.sort((a, b) => b.savesCents - a.savesCents)[0];
  return item(
    "rates",
    "tap",
    `Refinancing your ${best.name} with ${best.lender} at ${formatRate(best.aprBps)} would save about ${formatCents(best.savesCents)} over its term, fees counted. Applying is your tap.`,
    { href: "/loans/refinance", label: "See the loan options" },
  );
}

function addonsItem(car: CarLoan): MonthlyItem | null {
  if (!car.available || !car.loan) return null;
  const open = car.addons.filter(
    (a) => a.worthCancelling && (a.status === "found" || a.status === "confirmed"),
  );
  if (open.length === 0) {
    return item("addons", "ok", "No add-on on your car loan is worth cancelling, or it's in hand.");
  }
  const refund = open.reduce((s, a) => s + a.refund.refundCents, 0);
  return item(
    "addons",
    "tap",
    `Cancelling ${open.map((a) => a.label).join(" and ")} could refund about ${formatCents(refund)}. The cancellation is drafted; you send it, or ask the team to.`,
    { href: "/loans/auto", label: "See the add-ons" },
  );
}

function costlyItem(c: CostlyBorrowing): MonthlyItem | null {
  if (c.lastMonthCents >= COSTLY_CREEP_MIN_CENTS) {
    return item(
      "costly",
      "tap",
      `Costly borrowing cost you ${formatCents(c.lastMonthCents)} in the last 30 days. There are cheaper ways out, and a way to stop the cycle.`,
      { href: "/loans/costly", label: "See the cheaper ways" },
    );
  }
  if (!c.any) return null;
  return item(
    "costly",
    "ok",
    "No payday loans, cash advances or overdraft fees in the last 30 days.",
  );
}

function rentItem(r: Renting): MonthlyItem | null {
  const due = r.deposits.find((x) => x.needsAttention);
  if (due) {
    const v = due.view;
    return item(
      "rent",
      "tap",
      v.status === "overdue"
        ? `Your ${formatCents(due.amountCents)} deposit was due back ${dayLabel(v.dueOn!)}; ask in writing (${v.rule.source}).`
        : `Your ${formatCents(due.amountCents)} deposit is due back by ${dayLabel(v.dueOn!)}.`,
      { href: "/loans/renting", label: "Your rent" },
    );
  }
  if (r.rise?.askAbout) {
    return item(
      "rent",
      "tap",
      `Your rent went up ${(r.rise.risePercentBps / 100).toFixed(1)}%, against a usual ${(r.rise.usualBps / 100).toFixed(0)}%: worth asking your landlord about.`,
      { href: "/loans/renting", label: "Your rent" },
    );
  }
  if (!r.renter) return null;
  return item("rent", "ok", "Your rent and deposits are in order.");
}

// The same step as the yearly debt review's (docs/feature-audit.md, cluster 14).
function cardRateItem(
  ci: CardInterest,
  asOf: string,
  level: CreditMonthly["level"],
): MonthlyItem | null {
  const step = rateStep(ci, asOf);
  if (step?.kind === "asked") {
    return item(
      "card_rate",
      "done",
      `Asked ${step.cards.join(" and ")} for a lower rate this month; I'll tell you what they answer.`,
    );
  }
  if (step?.kind !== "next") return null;
  return item(
    "card_rate",
    "tap",
    `Ask ${step.name} for a lower rate: about ${formatCents(step.savingYearlyCents)} a year${level === "all" ? "" : ". At Handle everything I'd send it myself"}.`,
    { href: "/loans/interest", label: "Ask for a lower rate" },
  );
}

// The check-up worked out now: every loan priced through the fit engine, so it is for Jane's
// monthly pass and for a question, not for every snapshot (those read the stored one).
export async function computeCreditMonthly(
  userId: string,
  { client = defaultClient, now = new Date(), book: given, parts = {} }: Options = {},
): Promise<CreditMonthly> {
  const book = await debtsOr(given, userId, { client, now });
  const asOf = isoDay(now);
  const [sector, advice, refi, borrowing, car, costly, renting, ci] = await Promise.all([
    autopilotFor(userId, "debt", { client, now }),
    adviceMode(userId, { client }),
    loadRefinance(userId, { client, now, book }),
    parts.borrowing ?? loadBorrowingPower(userId, { client }),
    parts.carLoan ?? loadCarLoan(userId, { client, now, book }),
    parts.costly ?? loadCostlyBorrowing(userId, { client, now }),
    parts.renting ?? loadRenting(userId, { client, now }),
    parts.cardInterest ?? loadCardInterest(userId, { client, now, book }),
  ]);
  const items = [
    softChecksItem(refi.checkedOn, borrowing),
    await ratesItem(userId, book, client, now),
    addonsItem(car),
    costlyItem(costly),
    rentItem(renting),
    cardRateItem(ci, asOf, sector.level),
  ].filter((i): i is MonthlyItem => i !== null);
  const any = book.debts.some((d) => (d.balanceCents ?? 0) > 0) || renting.renter || costly.any;
  return {
    available: any,
    advice,
    level: sector.level,
    month: asOf.slice(0, 7),
    checkedOn: null,
    items: any ? items : [],
    did: [],
  };
}

// Jane's monthly pass (src/lib/debt-refresh.ts), after the soft checks, once a month: at Handle
// everything she sends the next lower-rate request herself (free, and not a credit
// application), at most once a month; then the check-up is kept for the chat to post once.
// Everything else waits for a tap. Returns the check-up, or null when this month's is done.
export async function runCreditMonthly(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CreditMonthly | null> {
  const db = scopedFor(userId, client);
  const asOf = isoDay(now);
  const watch = await db.debtWatches.findFirst({ select: { monthlyOn: true } });
  if (watch?.monthlyOn && isoDay(watch.monthlyOn).slice(0, 7) === asOf.slice(0, 7)) return null;
  const did: string[] = [];
  const book = await debtsOr(undefined, userId, { client, now });
  const asked = await askNextRateHerself(userId, { client, now, book });
  if (asked) did.push(`a lower-rate request to ${asked}`);
  const monthly = await computeCreditMonthly(userId, { client, now, book });
  const kept = { month: monthly.month, items: monthly.items, did };
  const data = {
    monthlyOn: new Date(`${asOf}T00:00:00Z`),
    monthly: kept as unknown as Prisma.InputJsonObject,
  };
  await upsertOnce(() =>
    db.debtWatches.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
  );
  await track(userId, "credit_monthly_done", {
    waiting: monthly.items.filter((i) => i.status === "tap").length,
    did: did.length,
  });
  return { ...monthly, checkedOn: asOf, did };
}

// The check-up Jane kept this month (cheap: for the snapshot and the page); null before one.
export async function loadCreditMonthly(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<CreditMonthly | null> {
  const [watch, sector, advice] = await Promise.all([
    scopedFor(userId, client).debtWatches.findFirst({
      select: { monthlyOn: true, monthly: true },
    }),
    autopilotFor(userId, "debt", { client }),
    adviceMode(userId, { client }),
  ]);
  if (!watch?.monthlyOn || !watch.monthly) return null;
  const kept = watch.monthly as unknown as { month: string; items: MonthlyItem[]; did: string[] };
  return {
    available: kept.items.length > 0,
    advice,
    level: sector.level,
    month: kept.month,
    checkedOn: isoDay(watch.monthlyOn),
    items: kept.items,
    did: kept.did,
  };
}
