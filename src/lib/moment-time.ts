// A moment with its time of day, in the person's timezone: "Nov 13, 9:37 AM". Never in UTC with
// "UTC" after it (debugger 11-14: the events box said "last checked Nov 13, 5:37 PM UTC" to someone
// in Los Angeles). The same on the server and in the browser, since the zone is given. Its own file,
// not ./day-label.ts: that one is in Home's first load, which is at its budget.
export function momentTimeLabel(at: Date | string, timezone: string): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}
