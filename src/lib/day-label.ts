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
