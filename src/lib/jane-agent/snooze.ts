import { validTimezone } from "@/lib/digest/week";
import { localTime } from "./quiet-hours";

// "Not now" (spec step 83): a message is hidden until the start of the person's next day,
// in their timezone (users.timezone, US Pacific when unset). After that, Jane's brain may
// bring it up again, if it still applies.

// How far the timezone is ahead of UTC at this moment, in milliseconds.
function offsetAt(time: number, timezone: string | null | undefined): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: validTimezone(timezone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(time))
      .map((p) => [p.type, Number(p.value)]),
  );
  const local = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second,
  );
  return local - Math.floor(time / 1000) * 1000;
}

// Midnight at the start of tomorrow, the person's own tomorrow.
export function startOfTomorrow(now: Date, timezone: string | null | undefined): Date {
  const [year, month, day] = localTime(now, timezone).date.split("-").map(Number);
  const midnight = Date.UTC(year, month - 1, day + 1);
  // Twice, in case the clocks change between the two guesses.
  const first = midnight - offsetAt(midnight, timezone);
  return new Date(midnight - offsetAt(first, timezone));
}
