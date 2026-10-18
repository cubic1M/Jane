import { CHARGES_PER_YEAR } from "@/config/detection";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput } from "@/detection/types";
import { daysBetween } from "@/detection/units";

// The next expected charge from each active recurring stream: the last charge plus the
// stream's usual gap, rolled forward past today. A first version of the bills forecast.

export type UpcomingCharge = { merchant: string; date: string; amountCents: number };

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function upcomingCharges(
  input: DetectionInput,
  { days, limit }: { days: number; limit: number },
): UpcomingCharge[] {
  const until = addDays(input.asOf, days);
  return buildStreams(input)
    .flatMap((stream): UpcomingCharge[] => {
      const last = stream.charges.at(-1);
      if (!stream.active || !stream.frequency || !last) return [];
      const gap = Math.round(365 / CHARGES_PER_YEAR[stream.frequency]);
      let next = addDays(last.date, gap);
      while (daysBetween(next, input.asOf) > 0) next = addDays(next, gap);
      return next <= until
        ? [{ merchant: stream.merchant, date: next, amountCents: stream.lastAmountCents }]
        : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant))
    .slice(0, limit);
}
