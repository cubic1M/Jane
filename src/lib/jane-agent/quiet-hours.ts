import { QUIET_END_HOUR, QUIET_START_HOUR } from "@/config/agent-chat";
import { validTimezone } from "@/lib/digest/week";

// The person's own clock (spec step 82): today's date and the hour in their timezone
// (users.timezone, US Pacific when unset), and whether it's quiet hours there.

export type LocalTime = { date: string; hour: number };

export function localTime(now: Date, timezone: string | null | undefined): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: validTimezone(timezone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
  };
}

// Quiet from QUIET_START_HOUR (9pm) until QUIET_END_HOUR (8am) local time. A window that
// doesn't cross midnight works too.
export function inQuietHours(
  now: Date,
  timezone: string | null | undefined,
  { start = QUIET_START_HOUR, end = QUIET_END_HOUR }: { start?: number; end?: number } = {},
): boolean {
  const { hour } = localTime(now, timezone);
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
