import { createHash, randomBytes } from "node:crypto";
import { CALENDAR_DAYS } from "@/config/calendar";
import { loadDetectionInput } from "@/detection/engine";
import { expectedIncome, upcomingBills } from "@/detection/forecast";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { buildCalendar, type CalendarEvent } from "./ics";

// The private money calendar: expected bills, deposits and goal dates as an iCalendar
// feed the person subscribes to in their own calendar app. The link's secret is stored
// only as a hash; resetting it makes the old link stop working at once. Events hold
// merchant names, amounts and dates, never account names or numbers.

type Options = { client?: PrismaClient; now?: Date };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
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
    data: { calendarTokenHash: hash(token), calendarCreatedAt: now },
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
    where: { calendarTokenHash: hash(token) },
    select: { id: true, deletedAt: true },
  });
  return user && !user.deletedAt ? user.id : null;
}

export async function calendarEvents(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CalendarEvent[]> {
  const input = await loadDetectionInput(userId, { client, now });
  const asOf = input.asOf;
  const until = addDays(asOf, CALENDAR_DAYS);
  const bills = upcomingBills(input, CALENDAR_DAYS).map((b): CalendarEvent => ({
    uid: `bill-${slug(b.merchant)}-${b.date}@${UID_DOMAIN}`,
    date: b.date,
    summary: `${b.merchant}, about ${formatCents(b.amountCents)}`,
    description: "Expected from your past charges. The date and amount are estimates.",
  }));
  const deposits = expectedIncome(input, until).map((d): CalendarEvent => ({
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
  return [...bills, ...deposits, ...goalEvents].sort(
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
