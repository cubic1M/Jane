import {
  DEPOSIT_STATES,
  DEPOSIT_WARN_DAYS,
  LOCAL_RENT,
  RENTING_SOURCES,
  RENT_LOOKBACK_DAYS,
  RENT_REPORTING,
  depositRule,
} from "@/config/renting";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import {
  depositView,
  enoughRent,
  rentPayments,
  rentRise,
  type DepositView,
  type RentPayment,
  type RentRise,
} from "@/planning/renting";

// Renting, counted (spec step 248), for one person. Rent found in their payments; reporting it
// to the credit bureaus through the reporting partner stand-in only after they opt in; a rent
// increase set beside what is usual; a security deposit followed to the day it is due back.
// Facts and the person's own choices: nothing is reported, sent or filed by Jane.

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export class RentingError extends Error {}

export type DepositRow = {
  id: string;
  amountCents: number;
  state: string;
  movedOutOn: string | null;
  returnedOn: string | null;
  returnedCents: number | null;
  view: DepositView;
  // Within the warning window, or past the date.
  needsAttention: boolean;
};

export type Renting = {
  // Looks like a renter: enough rent payments in the last year.
  renter: boolean;
  payments: RentPayment[];
  monthlyCents: number | null;
  rise: RentRise | null;
  reporting: {
    on: boolean;
    since: string | null;
    partner: string;
    monthlyFeeCents: number;
    note: string;
  };
  deposits: DepositRow[];
  sources: typeof RENTING_SOURCES;
  localRent: typeof LOCAL_RENT;
};

export async function loadRenting(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Renting> {
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - RENT_LOOKBACK_DAYS * DAY_MS);
  const [rows, reporting, deposits] = await Promise.all([
    db.transactions.findMany({
      where: { date: { gte: since }, pending: false, pfcDetailed: "RENT_AND_UTILITIES_RENT" },
      select: { date: true, amountCents: true, description: true, pfcDetailed: true },
      orderBy: { date: "asc" },
    }),
    db.rentReporting.findFirst(),
    db.securityDeposits.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const payments = rentPayments(
    rows.map((r) => ({ ...r, pfc: r.pfcDetailed, date: isoDay(r.date) })),
  );
  const today = isoDay(now);
  const depositRows = deposits.map((d) => {
    const movedOutOn = d.movedOutOn ? isoDay(d.movedOutOn) : null;
    const returnedOn = d.returnedOn ? isoDay(d.returnedOn) : null;
    const view = depositView({ state: d.state, movedOutOn, returnedOn }, today);
    return {
      id: d.id,
      amountCents: d.amountCents,
      state: d.state,
      movedOutOn,
      returnedOn,
      returnedCents: d.returnedCents,
      view,
      needsAttention:
        view.status === "overdue" ||
        (view.status === "due" && (view.daysLeft ?? 99) <= DEPOSIT_WARN_DAYS),
    };
  });
  return {
    renter: enoughRent(payments),
    payments,
    monthlyCents: payments.length ? payments[payments.length - 1].cents : null,
    rise: rentRise(payments),
    reporting: {
      on: reporting !== null,
      since: reporting ? isoDay(reporting.optedInAt) : null,
      partner: RENT_REPORTING.partner,
      monthlyFeeCents: RENT_REPORTING.monthlyFeeCents,
      note: RENT_REPORTING.note,
    },
    deposits: depositRows,
    sources: RENTING_SOURCES,
    localRent: LOCAL_RENT,
  };
}

// Rent reporting is the person's choice: on needs their tap, off is always allowed.
export async function setRentReporting(
  userId: string,
  on: boolean,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (on) {
    await client.rentReporting.upsert({
      where: { userId },
      create: { userId, partner: RENT_REPORTING.partner, optedInAt: now },
      update: {},
    });
  } else {
    await client.rentReporting.deleteMany({ where: { userId } });
  }
  await logAudit({ type: "user", id: userId }, "rent_reporting_changed", null, { on });
}

export async function saveDeposit(
  userId: string,
  input: { amountCents: number; state: string; movedOutOn: string | null },
  { client = defaultClient }: Options = {},
): Promise<string> {
  const state = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new RentingError("Pick the state you rented in.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RentingError("The deposit should be a dollar amount.");
  }
  if (input.movedOutOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.movedOutOn)) {
    throw new RentingError("Give the day you moved out as a date.");
  }
  const row = await client.securityDeposit.create({
    data: {
      userId,
      amountCents: input.amountCents,
      state,
      movedOutOn: input.movedOutOn ? new Date(input.movedOutOn) : null,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "security_deposit_saved",
    { type: "security_deposit", id: row.id },
    {
      state,
      knownRule: DEPOSIT_STATES.includes(state),
      days: depositRule(state).days,
    },
  );
  return row.id;
}

export async function markDepositReturned(
  userId: string,
  id: string,
  returnedCents: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (!Number.isInteger(returnedCents) || returnedCents < 0) {
    throw new RentingError("The amount returned should be a dollar amount.");
  }
  const done = await client.securityDeposit.updateMany({
    where: { id, userId },
    data: { returnedOn: new Date(isoDay(now)), returnedCents },
  });
  if (done.count === 0) throw new RentingError("I can't find that deposit.");
  await logAudit(
    { type: "user", id: userId },
    "security_deposit_saved",
    { type: "security_deposit", id },
    {
      returned: true,
    },
  );
}
