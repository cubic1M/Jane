import { REVIEW_ITEM_TITLES, type ReviewItemKey, type ReviewReason } from "@/config/debt-review";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DebtBook } from "@/insights/debts";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { loadCardInterest, sendRateRequest, type CardInterest } from "@/lib/card-interest";
import { loadCreditBuilding, runCreditBuilding, type CreditBuilding } from "@/lib/credit-building";
import { loadCreditGoals, type CreditGoals } from "@/lib/credit-goals";
import { dayLabel } from "@/lib/day-label";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { debtsOr } from "@/lib/debts";
import { loadHomeEquity, type HomeEquity } from "@/lib/home-equity";
import { formatCents } from "@/lib/money";
import { autopilotFor, mayAct, recordAct } from "@/lib/sector-autopilot";
import { upsertOnce } from "@/lib/unique-race";
import { reviewReason } from "@/planning/debt-review";

// Debt on autopilot, round two (spec step 230): the yearly debt review. Once a year, and early
// after a raise, a new loan or a missed payment, Jane goes over everything about debts and
// credit in one pass: payments timed to statement dates, 0% promotions on pace, lower-rate
// requests, PMI and escrow, and score goals. What she may do by herself within the debt
// caps she does (a payment before a statement; at Handle everything, a rate request); the
// rest becomes one message with each item's button. Nothing above a cap happens without a tap.

type Parts = {
  creditBuilding?: CreditBuilding;
  cardInterest?: CardInterest;
  homeEquity?: HomeEquity;
  creditGoals?: CreditGoals;
};
type Options = {
  client?: PrismaClient;
  now?: Date;
  book?: DebtBook;
  parts?: Parts;
};

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// What a button on an item does; the chat message and the page turn this into a button.
export type ReviewTap =
  | { kind: "pay"; accountId: string; closesOn: string; card: string; amountCents: number }
  | { kind: "ask"; requestId: string; card: string }
  | { kind: "sent"; which: "pmi" | "escrow" }
  | { kind: "goal"; goalId: string }
  | { kind: "link"; href: string; label: string };

export type ReviewItem = {
  key: ReviewItemKey;
  title: string;
  // done: Jane did it; tap: it waits for the person; ok: checked, nothing to do.
  status: "done" | "tap" | "ok";
  text: string;
  tap?: ReviewTap;
};

export type DebtReview = {
  available: boolean;
  // Demo advice mode: the message carries the label.
  advice: boolean;
  level: "ask" | "safe" | "all";
  // The latest review Jane did, and why.
  review: { on: string; reason: ReviewReason } | null;
  // Why one is due now, if it is.
  due: ReviewReason | null;
  items: ReviewItem[];
};

const item = (
  key: ReviewItemKey,
  status: ReviewItem["status"],
  text: string,
  tap?: ReviewTap,
): ReviewItem => ({ key, title: REVIEW_ITEM_TITLES[key], status, text, tap });

function statementsItem(cb: CreditBuilding): ReviewItem {
  const s = cb.statement;
  if (!cb.available || !s) {
    return item("statements", "ok", "No card statement is closing soon, so nothing to time.");
  }
  if (s.scheduled) {
    return item(
      "statements",
      "done",
      `${formatCents(s.scheduled.amountCents)} goes to your ${s.cardName} on ${dayLabel(s.scheduled.runOn)}, before its statement closes on ${dayLabel(s.closesOn)}${s.scheduled.by === "autopilot" ? " (I scheduled it within your caps)" : ""}.`,
    );
  }
  if (s.due && s.canPay && s.suggested) {
    return item(
      "statements",
      "tap",
      `Pay ${formatCents(s.suggested.amountCents)} toward your ${s.cardName} before its statement closes on ${dayLabel(s.closesOn)}, so the balance it reports is lower.`,
      {
        kind: "pay",
        accountId: s.accountId,
        closesOn: s.closesOn,
        card: s.cardName,
        amountCents: s.suggested.amountCents,
      },
    );
  }
  return item(
    "statements",
    "ok",
    `Your ${s.cardName} statement closes on ${dayLabel(s.closesOn)}; there's no payment to time yet.`,
  );
}

function promosItem(ci: CardInterest): ReviewItem {
  if (!ci.available || ci.promos.length === 0) {
    return item("promos", "ok", "No 0% promotions on your list.");
  }
  const off = ci.promos.filter((p) => !p.plan.onPace && !p.plan.ended);
  if (off.length > 0) {
    const p = off[0];
    return item(
      "promos",
      "tap",
      `${p.cardName}'s 0% ends ${dayLabel(p.endsOn, { year: true })}, and it takes ${formatCents(p.plan.monthlyNeededCents)} a month to clear ${formatCents(p.balanceCents)}; you're paying ${formatCents(p.plan.monthlyPaidCents)}.`,
      { kind: "link", href: "/loans/interest", label: "See the promotion" },
    );
  }
  return item(
    "promos",
    "ok",
    `${ci.promos.length === 1 ? "Your 0% promotion is" : `All ${ci.promos.length} 0% promotions are`} on pace to clear in time.`,
  );
}

function ratesItem(ci: CardInterest, asOf: string): ReviewItem {
  if (!ci.available)
    return item("rates", "ok", "Rate requests aren't available for your accounts yet.");
  const next = ci.cards.find((c) => c.rate && !c.rate.sent);
  const recent = ci.requests.filter((r) => Date.parse(asOf) - Date.parse(r.sentOn) <= 30 * DAY_MS);
  if (next?.rate) {
    return item(
      "rates",
      "tap",
      `Ask ${next.name} for a lower rate: it could save about ${formatCents(next.rate.savingYearlyCents)} a year, and the request is written.`,
      { kind: "ask", requestId: next.rate.id, card: next.name },
    );
  }
  if (recent.length > 0) {
    return item(
      "rates",
      "done",
      `Asked ${recent.map((r) => r.cardName).join(" and ")} for a lower rate this month; I'll tell you what they answer.`,
    );
  }
  return item("rates", "ok", "No card has a lower rate worth asking for right now.");
}

function homeItem(h: HomeEquity): ReviewItem | null {
  if (!h.available) return null;
  if (h.pmi?.canAskNow && !h.pmi.endsNow && h.pmiLetter && !h.facts.pmiLetterSentOn) {
    return item(
      "home",
      "tap",
      "PMI can come off: your loan is under 80% of the home's original value, and the request is drafted for you to send.",
      { kind: "sent", which: "pmi" },
    );
  }
  if (h.escrow?.kind === "over" && h.escrowLetter && !h.facts.escrowRequestSentOn) {
    return item(
      "home",
      "tap",
      "Your escrow holds more than your bills need, and the refund request is drafted for you to send.",
      { kind: "sent", which: "escrow" },
    );
  }
  if (h.pmi?.endsNow && h.hasPmi) {
    return item(
      "home",
      "tap",
      "Your loan is under 78% of the home's original value, so PMI has to end by itself. Ask your servicer if it's still in your payment.",
      { kind: "link", href: "/loans/equity", label: "See your home loan" },
    );
  }
  if (h.facts.originalValueCents === null || h.escrow === null) {
    return item(
      "home",
      "tap",
      "Tell me the home's original value and your yearly tax and insurance bills, and I'll check PMI and escrow.",
      { kind: "link", href: "/loans/equity", label: "Add them" },
    );
  }
  return item("home", "ok", "PMI and escrow checked: nothing to ask your servicer for.");
}

function goalsItem(g: CreditGoals): ReviewItem | null {
  if (!g.available || g.goals.length === 0) return null;
  const behind = g.goals.find((x) => !x.plan.reaches);
  const todo = g.goals.find((x) => x.thisMonth.some((i) => !i.done));
  if (todo?.id) {
    return item(
      "goals",
      "tap",
      `${todo.title}: this month's list isn't ticked off yet${behind ? `, and the plan for ${behind.targetScore} no longer reaches it on the simulator` : ""}.`,
      { kind: "goal", goalId: todo.id },
    );
  }
  if (behind) {
    return item(
      "goals",
      "tap",
      `The plan for ${behind.targetScore} by ${dayLabel(behind.targetDate, { year: true })} no longer reaches it on the simulator: the best is about ${behind.plan.best}.`,
      { kind: "link", href: "/loans/goal", label: "See your credit plan" },
    );
  }
  return item(
    "goals",
    "ok",
    `${g.goals.length === 1 ? "Your score goal is" : "Your score goals are"} on track.`,
  );
}

async function latestPaycheck(userId: string, client: PrismaClient, now: Date) {
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: {
      date: { gte: new Date(now.getTime() - 45 * DAY_MS) },
      amountCents: { lt: 0 },
      pfcDetailed: { in: ["INCOME_SALARY", "INCOME_WAGES"] },
    },
    select: { amountCents: true },
    orderBy: { date: "desc" },
    take: 1,
  });
  return rows[0] ? Math.abs(rows[0].amountCents) : null;
}

export async function loadDebtReview(
  userId: string,
  { client = defaultClient, now = new Date(), book: given, parts = {} }: Options = {},
): Promise<DebtReview> {
  const db = scopedFor(userId, client);
  const book = await debtsOr(given, userId, { client, now });
  const owing = book.debts.filter((d) => (d.balanceCents ?? 0) > 0);
  const asOf = isoDay(now);
  const [watch, sector, advice, cb, ci, home, goals, pay] = await Promise.all([
    db.debtWatches.findFirst({
      select: { reviewOn: true, reviewReason: true, reviewKeys: true, reviewPayCents: true },
    }),
    autopilotFor(userId, "debt", { client, now }),
    adviceMode(userId, { client }),
    parts.creditBuilding ?? loadCreditBuilding(userId, { client, now }),
    parts.cardInterest ?? loadCardInterest(userId, { client, now, book }),
    parts.homeEquity ?? loadHomeEquity(userId, { client, now }),
    parts.creditGoals ?? loadCreditGoals(userId, { client, now, book }),
    latestPaycheck(userId, client, now),
  ]);
  const due = reviewReason({
    today: asOf,
    lastOn: watch?.reviewOn ? isoDay(watch.reviewOn) : null,
    lastKeys: (watch?.reviewKeys ?? []) as string[],
    lastPayCents: watch?.reviewPayCents ?? null,
    keys: owing.map((d) => d.key),
    anyOverdue: owing.some((d) => d.overdue),
    payCents: pay,
  });
  const items = [
    statementsItem(cb),
    promosItem(ci),
    ratesItem(ci, asOf),
    homeItem(home),
    goalsItem(goals),
  ].filter((i): i is ReviewItem => i !== null);
  return {
    available: owing.length > 0,
    advice,
    level: sector.level,
    review:
      watch?.reviewOn && watch.reviewReason
        ? { on: isoDay(watch.reviewOn), reason: watch.reviewReason as ReviewReason }
        : null,
    due,
    items: owing.length > 0 ? items : [],
  };
}

// Jane's pass (src/lib/debt-refresh.ts): when a review is due she does what she may within
// the debt caps, then notes the review so the chat can post it once. Returns what she did.
export async function runDebtReview(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ reason: ReviewReason; did: string[] } | null> {
  const book = await debtsOr(undefined, userId, { client, now });
  const review = await loadDebtReview(userId, { client, now, book });
  if (!review.due) return null;
  const did: string[] = [];
  // A payment before a statement closes: the debt caps and the checking cushion decide.
  if (await runCreditBuilding(userId, { client, now })) did.push("a payment before a statement");
  // Only at Handle everything: one lower-rate request to the lender stand-in, free to send.
  const may = await mayAct(userId, "debt", { needs: "all", cents: 0 }, { client, now });
  if (may.ok) {
    const ci = await loadCardInterest(userId, { client, now, book });
    const next = ci.cards.find((c) => c.rate && !c.rate.sent);
    if (next?.rate) {
      await sendRateRequest(userId, next.rate.id, { client, now });
      await recordAct(userId, "debt", 0, `Asked ${next.name} for a lower rate`, { client, now });
      did.push(`a lower-rate request to ${next.name}`);
    }
  }
  const owing = book.debts.filter((d) => (d.balanceCents ?? 0) > 0);
  const data = {
    reviewOn: new Date(`${isoDay(now)}T00:00:00Z`),
    reviewReason: review.due,
    reviewKeys: owing.map((d) => d.key),
    reviewPayCents: await latestPaycheck(userId, client, now),
  };
  const db = scopedFor(userId, client);
  await upsertOnce(() =>
    db.debtWatches.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
  );
  await logAudit(
    SYSTEM_ACTOR,
    "debt_review_done",
    { type: "debt_review", id: userId },
    { reason: review.due, did: did.length },
  );
  await track(userId, "debt_review_done", { reason: review.due });
  return { reason: review.due, did };
}
