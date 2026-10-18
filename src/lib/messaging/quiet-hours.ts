import { TEXT_QUIET_END_HOUR, TEXT_QUIET_START_HOUR } from "@/config/messaging";
import { validTimezone } from "@/lib/digest/week";

// Quiet hours for texts (spec step 78): nothing between 9pm and 8am in the person's own
// timezone. A text that comes up then waits until 8am.

const MINUTE = 60 * 1000;

// The wall-clock time in a timezone, written as if it were UTC.
function localAsUtc(at: Date, timezone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ),
  );
}

export function isQuietHour(hour: number): boolean {
  return hour >= TEXT_QUIET_START_HOUR || hour < TEXT_QUIET_END_HOUR;
}

// When a text may go out: now, or 8am local if it's quiet hours.
export function sendTime(now: Date, timezone: string | null | undefined): Date {
  const tz = validTimezone(timezone);
  const local = localAsUtc(now, tz);
  if (!isQuietHour(local.getUTCHours())) return now;
  // 8am on the local day, or the next one when it's evening.
  const morning = new Date(local);
  morning.setUTCHours(TEXT_QUIET_END_HOUR, 0, 0, 0);
  if (local.getUTCHours() >= TEXT_QUIET_END_HOUR) {
    morning.setUTCDate(morning.getUTCDate() + 1);
  }
  // Back to a real instant: subtract the offset at that time (twice, for a DST change).
  let guess = new Date(morning.getTime() - (local.getTime() - now.getTime()));
  for (let i = 0; i < 2; i++) {
    const offset = localAsUtc(guess, tz).getTime() - guess.getTime();
    guess = new Date(morning.getTime() - offset);
  }
  // Rounded to the minute, never earlier than now.
  return new Date(Math.max(now.getTime(), Math.ceil(guess.getTime() / MINUTE) * MINUTE));
}

export function inQuietHours(now: Date, timezone: string | null | undefined): boolean {
  return sendTime(now, timezone).getTime() > now.getTime();
}
