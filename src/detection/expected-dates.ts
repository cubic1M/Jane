import type { Stream } from "./streams";
import { dayOfMonth, nextOccurrence } from "./units";

// Every date the stream is expected on, from today through `until`.
export function expectedDates(stream: Stream, asOf: string, until: string): string[] {
  const frequency = stream.frequency;
  // Plaid's prediction when it's still ahead, else the last charge; later dates keep that
  // day of the month.
  const predicted =
    stream.predictedNextDate && stream.predictedNextDate >= asOf ? stream.predictedNextDate : null;
  const from = predicted ?? stream.lastDate;
  if (!from) return [];
  const anchor = dayOfMonth(from);
  const step = (date: string) => (frequency ? nextOccurrence(date, frequency, anchor) : null);

  let next: string | null = predicted ?? step(from);
  while (next && next < asOf) next = step(next);
  const dates: string[] = [];
  while (next && next <= until) {
    dates.push(next);
    next = step(next);
  }
  return dates;
}
