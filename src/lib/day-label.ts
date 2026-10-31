// A day as people read it: "Oct 26", or "Oct 26, 2026" with the year. Takes a "YYYY-MM-DD"
// day or a Date, read in UTC like the rest of the app's days.
export function dayLabel(day: string | Date, { year = false }: { year?: boolean } = {}): string {
  const date = typeof day === "string" ? new Date(`${day.slice(0, 10)}T00:00:00Z`) : day;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

// A "YYYY-MM" month as people read it: "Oct 2026"; "October 2026" with long, and without the
// year when year is false. Read in UTC.
export function monthLabel(
  month: string,
  { long = false, year = true }: { long?: boolean; year?: boolean } = {},
): string {
  return new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

// A moment (when something happened: an upload, a note, a checkup) as the person's own day, in
// their timezone (validTimezone in src/lib/digest/week.ts). Days above are calendar days and read
// in UTC; a moment isn't: at 9pm in Los Angeles it is already tomorrow in UTC, and an upload made
// tonight read "added" tomorrow (overnight debugger, 2026-10-30).
export function momentLabel(
  at: Date | string,
  timezone: string,
  { year = false }: { year?: boolean } = {},
): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: timezone,
  });
}
