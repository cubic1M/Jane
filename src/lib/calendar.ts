import { randomBytes } from "node:crypto";
import { CALENDAR_DAYS } from "@/config/calendar";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { sameThing } from "@/insights/coming-up";
import type { Deadline } from "@/insights/deadlines";
import { loadComingUp } from "@/lib/coming-up";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { buildCalendar, type CalendarEvent } from "./ics";
import { sha256Hex } from "@/lib/hash";

// The private money calendar: expected bills, deposits, deadlines and goal dates as an
// iCalendar feed the person subscribes to in their own calendar app. The link's secret is
// stored only as a hash; resetting it makes the old link stop working at once. Events hold
// merchant names, amounts and dates, never account names or numbers. Bills, deposits and
// deadlines come from the one coming-up source (src/lib/coming-up.ts), so the calendar says
// what Today says.

type Options = { client?: PrismaClient; now?: Date };

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "item";
const UID_DOMAIN = "money-calendar.financial-controller";

// A new secret link (replacing any old one). The token is returned once, to show the person.
export async function createCalendarToken(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await client.user.update({
    where: { id: userId },
    data: { calendarTokenHash: sha256Hex(token), calendarCreatedAt: now },
  });
  return token;
}

export async function turnOffCalendar(userId: string, { client = defaultClient }: Options = {}) {
  await client.user.update({
    where: { id: userId },
    data: { calendarTokenHash: null, calendarCreatedAt: null },
  });
}

// Whose feed a link opens, or null if it was reset, turned off, or never existed.
export async function userForCalendarToken(
  token: string,
  { client = defaultClient }: Options = {},
): Promise<string | null> {
  if (!token) return null;
  const user = await client.user.findUnique({
    where: { calendarTokenHash: sha256Hex(token) },
    select: { id: true, deletedAt: true },
  });
  return user && !user.deletedAt ? user.id : null;
}

// A deadline's words for the calendar. Card and loan payments and card fees are named after
// the account, so the feed says what they are instead.
function deadlineWords(d: Deadline): { summary: string; description?: string } {
  const amount = d.amountCents === null ? "" : `, about ${formatCents(d.amountCents)}`;
  if (d.source === "loans") {
    return {
      summary: `Card or loan payment due${amount}`,
      description: "As your bank reports it.",
    };
  }
  if (d.key.startsWith("annual_fee:")) {
    return {
      summary: `Card annual fee${amount}`,
      description: "An estimate, a year after the last one.",
    };
  }
  return { summary: d.title, ...(d.detail ? { description: d.detail } : {}) };
}

export async function calendarEvents(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CalendarEvent[]> {
  const ahead = await loadComingUp(userId, { client, now, days: CALENDAR_DAYS });
  const asOf = ahead.asOf;
  const until = addDays(asOf, CALENDAR_DAYS);
  const deadlines = ahead.deadlines.filter((d) => d.date >= asOf && d.date <= until);
  // A bill that is also a deadline that day (a yearly renewal, a card payment) is listed
  // once, as the deadline, as on Today.
  const bills = ahead.bills
    .filter((b) => !deadlines.some((d) => sameThing(b, d)))
    .map((b): CalendarEvent => ({
      uid: `bill-${slug(b.merchant)}-${b.date}@${UID_DOMAIN}`,
      date: b.date,
      summary: `${b.merchant}, about ${formatCents(b.amountCents)}`,
      description: "Expected from your past charges. The date and amount are estimates.",
    }));
  const dated = deadlines.map((d): CalendarEvent => ({
    uid: `deadline-${slug(d.key)}@${UID_DOMAIN}`,
    date: d.date,
    ...deadlineWords(d),
  }));
  const deposits = ahead.deposits.map((d): CalendarEvent => ({
    uid: `deposit-${slug(d.merchant)}-${d.date}@${UID_DOMAIN}`,
    date: d.date,
    summary: `Expected deposit, about ${formatCents(d.amountCents)}`,
    description: "Expected from your past deposits. The date and amount are estimates.",
  }));
  const goals = await scopedFor(userId, client).savingsGoals.findMany({
    select: { id: true, name: true, targetCents: true, targetDate: true },
  });
  const goalEvents = goals.map((g): CalendarEvent => ({
    uid: `goal-${g.id}@${UID_DOMAIN}`,
    date: g.targetDate.toISOString().slice(0, 10),
    summary: `Goal: ${g.name} (${formatCents(g.targetCents)})`,
  }));
  return [...bills, ...dated, ...deposits, ...goalEvents].sort(
    (a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid),
  );
}

export async function calendarFeed(userId: string, options: Options = {}): Promise<string> {
  return buildCalendar(
    "Money calendar",
    await calendarEvents(userId, options),
    options.now ?? new Date(),
  );
}
