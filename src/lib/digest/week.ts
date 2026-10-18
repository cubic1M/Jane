import { DEFAULT_TIMEZONE } from "@/config/digest";

// The digest week runs Monday to Sunday in the person's own timezone.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(now: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

export function validTimezone(timezone: string | null | undefined): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

// The Monday (as a UTC midnight date) of the person's current week.
export function weekStart(now: Date, timezone: string | null | undefined): Date {
  const { date, weekday } = localParts(now, validTimezone(timezone));
  const sinceMonday = (weekday + 6) % 7;
  return new Date(date.getTime() - sinceMonday * 24 * 60 * 60 * 1000);
}

// Today's date in the person's timezone, as YYYY-MM-DD.
export function localDate(now: Date, timezone: string | null | undefined): string {
  return localParts(now, validTimezone(timezone)).date.toISOString().slice(0, 10);
}
