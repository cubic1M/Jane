import { loadDetectionInput } from "@/detection/engine";
import { expectedIncome, upcomingBills } from "@/detection/forecast";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ComingUpBill } from "@/insights/coming-up";
import type { Deadline } from "@/insights/deadlines";
import { db as defaultClient } from "@/lib/db";
import {
  DEADLINE_SOURCES,
  listDeadlines,
  transactionDeadlines,
  transactionDeadlinesFrom,
} from "./deadlines";

// What's coming up, from one place (docs/feature-audit.md, cluster 3): the bills forecast
// (spec step 16), the deposits expected, and every deadline (spec step 71: renewals, trials,
// return windows, card and loan due dates, documents, policies, open enrollment and the
// person's own dates). Today, the Ahead hub and the money calendar (spec step 38) all read it,
// so a date is the same everywhere. Bill reminders (spec step 32) and bill pay (spec step 145)
// work from the same forecast and the bank's own due dates.

export type Deposit = { merchant: string; date: string; amountCents: number };

export type ComingUp = {
  asOf: string;
  // The detection input it was worked out from, for readers that need more of it.
  input: DetectionInput;
  bills: ComingUpBill[];
  deposits: Deposit[];
  deadlines: Deadline[];
};

// The regular bills expected in the next `days` days, soonest first. Pure.
export function billsAhead(input: DetectionInput, days: number): ComingUpBill[] {
  return upcomingBills(input, days).map(({ merchant, date, amountCents }) => ({
    merchant,
    date,
    amountCents,
  }));
}

// `input` when it's loaded already (Today has it): the deadlines from transactions reuse it.
export async function loadComingUp(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    days,
    input,
  }: { client?: PrismaClient; now?: Date; days: number; input?: DetectionInput },
): Promise<ComingUp> {
  const loaded = input ?? (await loadDetectionInput(userId, { client, now }));
  const deadlines = await listDeadlines(userId, {
    client,
    now,
    sources: DEADLINE_SOURCES.map((source) =>
      source === transactionDeadlines ? transactionDeadlinesFrom(loaded) : source,
    ),
  });
  return {
    asOf: loaded.asOf,
    input: loaded,
    bills: billsAhead(loaded, days),
    deposits: expectedIncome(loaded, addDays(loaded.asOf, days)).map(
      ({ merchant, date, amountCents }) => ({ merchant, date, amountCents }),
    ),
    deadlines,
  };
}
