import { TAX_PLAN } from "@/config/tax-plan";
import { CALENDAR_ITEMS, YEAR_END_FROM_DAY, type CalendarKey } from "@/config/tax-calendar";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { loadGiving } from "@/lib/giving";
import { loadMultiYear } from "@/lib/multi-year";
import { mayAct, recordAct, autopilotFor } from "@/lib/sector-autopilot";
import { loadSelfEmployed, recordTaxPayment, type SelfEmployedView } from "@/lib/self-employed";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { filingYear } from "@/lib/tax-filing";
import { loadIdentity, type IdentityView } from "@/lib/tax-identity";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxPlan } from "@/lib/tax-plan";
import { taxPaymentPartnerFor } from "@/lib/tax-payments";
import { checkFrom } from "@/lib/tax-withholding";
import {
  inPayWindow,
  nextAhead,
  planFor,
  MONTH_NAMES,
  type CalendarPlan,
} from "@/planning/tax-calendar";

// The tax year that runs itself (spec step 223). A calendar of what Jane does each month for
// taxes, on its own within the "taxes" sector's level and caps, or by asking for a tap:
// the January IP PIN and the form chase, estimated payments paid through the payment stand-in
// a few days before they're due, the mid-year withholding check, December's year-end moves
// in one message, filing day, and the refund tracked. Nothing is paid above the cap, or at
// the "ask first" level, without a tap; signing and filing a return are always the person's.

type Options = { client?: PrismaClient; now?: Date };

export class TaxCalendarError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type ItemStatus = "done" | "tap" | "waiting" | "nothing";

export type CalendarItemView = {
  key: CalendarKey;
  title: string;
  status: ItemStatus;
  detail: string;
};

export type DueEstimate = {
  dueOn: string;
  cents: number;
  // Why Jane doesn't pay it on its own: null when it will (or did).
  needsTap: "level" | "action_cap" | "monthly_cap" | "no_partner" | null;
  paid: boolean;
};

export type TaxCalendarView = {
  year: number;
  month: number;
  label: string;
  advice: boolean;
  // Jane may act on its own for taxes (level "safe" or above).
  acts: boolean;
  items: CalendarItemView[];
  due: DueEstimate[];
  months: CalendarPlan[];
  yearEnd: YearEndView | null;
};

export type YearEndView = {
  year: number;
  lines: string[];
  // Moves not yet on the deadlines.
  open: number;
};

export async function loadYearEnd(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<YearEndView | null> {
  const today = iso(now);
  if (Number(today.slice(5, 7)) !== 12 || Number(today.slice(8, 10)) < YEAR_END_FROM_DAY)
    return null;
  const year = Number(today.slice(0, 4));
  const plan = await loadTaxPlan(userId, { client, now });
  const advice = plan.advice;
  const lines: string[] = [];
  const open = plan.moves.filter((m) => m.open && !m.handled);
  const listed = plan.moves.filter((x) => x.open && x.handled !== "no");
  for (const m of listed) lines.push(`${m.title}, by ${dayLabel(m.deadline)}`);
  // A move already listed isn't said again as a count (docs/feature-audit.md, cluster 12): the
  // plan's "Sell at a loss" is the harvest, and "Make this year's gifts" the giving.
  const has = (key: string) => listed.some((m) => m.key === key);
  if (advice) {
    const [invest, giving, years] = await Promise.all([
      loadInvestmentTaxes(userId, year, { client, now }),
      loadGiving(userId, { client, now }),
      loadMultiYear(userId, { client, now }),
    ]);
    if (invest.harvest.length > 0 && !has("harvest")) {
      lines.push(
        `${invest.harvest.length} ${invest.harvest.length === 1 ? "loss" : "losses"} you could harvest before December 31`,
      );
    }
    if (giving.options.length > 0 && !giving.dismissed && !has("giving")) {
      lines.push(`${giving.options.length} ways to give that would lower your tax`);
    }
    if (years.moves[0]) lines.push(years.moves[0].title);
  }
  if (lines.length === 0) return null;
  return { year, lines, open: open.length };
}

export async function loadTaxCalendar(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & {
    loaded?: {
      estimate: TaxEstimateView;
      advice: boolean;
      selfEmployed?: SelfEmployedView;
      identity?: IdentityView;
    };
  } = {},
): Promise<TaxCalendarView> {
  const today = iso(now);
  const month = Number(today.slice(5, 7));
  const db = scopedFor(userId, client);
  const fYear = filingYear(today);
  const [advice, setting, se, partner, paid, docs, identity, ret] = await Promise.all([
    loaded ? loaded.advice : adviceMode(userId, { client }),
    autopilotFor(userId, "taxes", { client, now }),
    loaded?.selfEmployed ??
      loadSelfEmployed(userId, {
        client,
        now,
        ...(loaded ? { loaded: { estimate: loaded.estimate, advice: loaded.advice } } : {}),
      }),
    taxPaymentPartnerFor(userId, { client }),
    db.taxPayments.findMany({ select: { dueOn: true } }),
    loadTaxDocuments(userId, fYear, { client, now }),
    loaded?.identity ?? loadIdentity(userId, { client, now }),
    db.taxReturns.findFirst({
      where: { year: fYear },
      select: { signedAt: true, submittedAt: true, acceptedAt: true, preview: true },
    }),
  ]);
  const acts = setting.level !== "ask";
  const paidOn = new Set(paid.map((p) => iso(p.dueOn)));
  const plan = se.federal.payments.filter((p) => !paidOn.has(p.date));
  const due: DueEstimate[] = [];
  for (const p of inPayWindow(plan, today)) {
    let needsTap: DueEstimate["needsTap"] = null;
    if (!partner) needsTap = "no_partner";
    else {
      const may = await mayAct(userId, "taxes", { needs: "safe", cents: p.cents }, { client, now });
      if (!may.ok) needsTap = may.reason;
    }
    due.push({ dueOn: p.date, cents: p.cents, needsTap, paid: false });
  }

  const check = checkFrom(se.estimate);
  const items: CalendarItemView[] = planFor(month).items.map(({ key, title }) => {
    const view = (status: ItemStatus, detail: string): CalendarItemView => ({
      key,
      title,
      status,
      detail,
    });
    switch (key) {
      case "ip_pin":
        if (identity.havePin) return view("done", "You have your IP PIN.");
        return identity.reminded
          ? view("done", "Getting your IP PIN is on your deadlines.")
          : view("tap", "Get an IP PIN from the IRS; I'll put it on your deadlines.");
      case "documents": {
        if (docs.forms.length === 0) return view("nothing", "I don't expect any forms.");
        if (docs.flagged.length > 0) {
          return view(
            "tap",
            `${docs.flagged.length} ${docs.flagged.length === 1 ? "form doesn't" : "forms don't"} match your accounts: say which is right.`,
          );
        }
        const missing = docs.forms.filter((f) => !f.received && !f.mayNotSend && !f.document);
        return missing.length > 0
          ? view(
              "waiting",
              `${missing.length} ${missing.length === 1 ? "form" : "forms"} still to come; I look every day.`,
            )
          : view("done", "Every form is in.");
      }
      case "estimate": {
        if (!se.federal.needed && paidOn.size === 0)
          return view("nothing", "No estimated payments are needed.");
        if (due.length > 0) {
          const d = due[0];
          const how =
            d.needsTap === null
              ? `I'll pay ${formatCents(d.cents)} before ${dayLabel(d.dueOn)}.`
              : d.needsTap === "no_partner"
                ? `${formatCents(d.cents)} is due ${dayLabel(d.dueOn)}; pay it at IRS Direct Pay.`
                : `${formatCents(d.cents)} is due ${dayLabel(d.dueOn)}; ${
                    d.needsTap === "level"
                      ? "you asked me to ask first"
                      : "it is over what I pay by myself"
                  }, so it's your tap.`;
          return view(d.needsTap === null ? "waiting" : "tap", how);
        }
        const next = nextAhead(plan, today);
        if (next)
          return view("waiting", `Next: ${formatCents(next.cents)} due ${dayLabel(next.date)}.`);
        return view(
          "done",
          paidOn.size > 0 ? "Your estimated payments are paid." : "No payment is due.",
        );
      }
      case "withholding":
        if (check.status === "unknown")
          return view("nothing", "I can't see enough of your pay to check.");
        return check.status === "on_track"
          ? view("done", "Your withholding is on track.")
          : view(
              "tap",
              check.status === "bill_coming"
                ? `Your withholding is short: about ${formatCents(Math.abs(check.refundCents))} would be owed. A W-4 change fixes it.`
                : `Your withholding is high: about ${formatCents(check.refundCents)} comes back as a refund. A W-4 change would put it in your paychecks.`,
            );
      case "filing_day":
        if (ret?.acceptedAt) return view("done", "Your return was accepted.");
        if (ret?.submittedAt)
          return view("waiting", "Your return is filed; I'm watching for the IRS to accept it.");
        if (ret) return view("tap", "Your return is ready for you to review and sign.");
        return view("waiting", "I get your return ready once every form is in.");
      case "refund": {
        if (!ret?.submittedAt) return view("nothing", "Nothing to track until you file.");
        const refund =
          (ret.preview as { federalRefundCents?: number } | null)?.federalRefundCents ?? 0;
        return ret.acceptedAt
          ? view(
              "done",
              refund > 0
                ? `Your ${formatCents(refund)} refund is on its way; I'm tracking it.`
                : "Accepted; nothing is owed back.",
            )
          : view("waiting", "I'll track your refund once it's accepted.");
      }
      case "year_end":
        return view("waiting", "One message with the moves still open, before December 31.");
      case "quiet":
        return view("nothing", CALENDAR_ITEMS.quiet.ask);
    }
  });

  const yearEnd = month === 12 ? await loadYearEnd(userId, { client, now }) : null;
  if (month === 12) {
    const item = items.find((i) => i.key === "year_end");
    if (item && yearEnd) {
      const n = `${yearEnd.lines.length} ${yearEnd.lines.length === 1 ? "move" : "moves"}`;
      if (yearEnd.open === 0) {
        item.status = "done";
        item.detail = `${n} open, all on your deadlines.`;
      } else if (acts) {
        item.status = "waiting";
        item.detail = `${n} open; I put the ones with a deadline on your deadlines on my next run.`;
      } else {
        item.status = "tap";
        item.detail = `${n} open: say which go on your deadlines.`;
      }
    } else if (item) {
      item.status = "nothing";
      item.detail = "No year-end moves are open.";
    }
  }
  return {
    year: Number(today.slice(0, 4)),
    month,
    label: MONTH_NAMES[month - 1],
    advice,
    acts,
    items,
    due,
    months: Array.from({ length: 12 }, (_, i) => planFor(i + 1)),
    yearEnd,
  };
}

// The tax plan's titles for the estimated payments' reminders.
const ESTIMATE_TITLES = (["estimated_1", "estimated_2", "estimated_3", "estimated_4"] as const).map(
  (k) => TAX_PLAN[k].title,
);

// Pays one estimated payment through the stand-in and records it where the quarterly plan
// reads it. By Jane (within the caps) or on the person's tap (the planned amount, whatever
// the caps). A due date can only be paid once.
export async function payEstimate(
  userId: string,
  dueOn: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "autopilot" | "tap" },
): Promise<{ cents: number; confirmation: string }> {
  const today = iso(now);
  const partner = await taxPaymentPartnerFor(userId, { client });
  if (!partner) {
    throw new TaxCalendarError("Pay this one at IRS Direct Pay, then tell me what you paid.");
  }
  const se = await loadSelfEmployed(userId, { client, now });
  const db = scopedFor(userId, client);
  if ((await db.taxPayments.count({ where: { dueOn: new Date(`${dueOn}T00:00:00Z`) } })) > 0) {
    throw new TaxCalendarError("That payment is already paid.");
  }
  const planned = inPayWindow(
    se.federal.payments.filter((p) => p.date === dueOn),
    today,
  )[0];
  if (!planned) throw new TaxCalendarError("That payment isn't due yet, or it isn't needed.");
  if (via === "autopilot") {
    const may = await mayAct(
      userId,
      "taxes",
      { needs: "safe", cents: planned.cents },
      { client, now },
    );
    if (!may.ok) throw new TaxCalendarError("That's over what I pay by myself.");
  }
  const { confirmation } = await partner.pay({ userId, dueOn, cents: planned.cents });
  await db.taxPayments.create({
    data: {
      userId,
      year: Number(dueOn.slice(0, 4)),
      dueOn: new Date(`${dueOn}T00:00:00Z`),
      cents: planned.cents,
      partner: partner.name,
      confirmation,
      via,
    },
  });
  // Its reminder on the deadlines (the tax plan's "Pay the … estimated tax payment", spec
  // step 167) is done: paying never left it open to remind again (docs/feature-audit.md).
  await db.deadlines.updateMany({
    where: { dueOn: new Date(`${dueOn}T00:00:00Z`), doneAt: null, title: { in: ESTIMATE_TITLES } },
    data: { doneAt: now },
  });
  // So the quarterly plan counts it.
  await recordTaxPayment(
    userId,
    { date: today, cents: planned.cents, to: "federal" },
    { client, now, via: "chat" },
  );
  if (via === "autopilot") {
    await recordAct(userId, "taxes", planned.cents, `Paid the ${dueOn} estimated payment`, {
      client,
      now,
    });
  }
  await logAudit(
    via === "tap" ? { type: "user", id: userId } : { type: "system", id: null },
    "tax_payment_made",
    { type: "user", id: userId },
    { due_on: dueOn, cents: planned.cents, via, partner: partner.name },
  );
  await track(userId, "tax_estimate_paid", { via });
  return { cents: planned.cents, confirmation };
}

// What Jane does on its own each run, at the levels that let it act: pays each estimated
// payment in its window that fits the caps. The rest are left for the person's tap.
export async function runTaxCalendar(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ paid: { dueOn: string; cents: number }[]; needTap: number }> {
  const calendar = await loadTaxCalendar(userId, { client, now });
  const paid: { dueOn: string; cents: number }[] = [];
  let needTap = 0;
  for (const d of calendar.due) {
    if (d.needsTap) {
      needTap += 1;
      continue;
    }
    const r = await payEstimate(userId, d.dueOn, { client, now, via: "autopilot" });
    paid.push({ dueOn: d.dueOn, cents: r.cents });
  }
  return { paid, needTap };
}
