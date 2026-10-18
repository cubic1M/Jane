import { upcomingBills } from "@/detection/forecast";
import type { DetectionInput } from "@/detection/types";

// The next few expected charges, for the home dashboard (from the bills forecast).

export type UpcomingCharge = { merchant: string; date: string; amountCents: number };

export function upcomingCharges(
  input: DetectionInput,
  { days, limit }: { days: number; limit: number },
): UpcomingCharge[] {
  return upcomingBills(input, days)
    .slice(0, limit)
    .map(({ merchant, date, amountCents }) => ({ merchant, date, amountCents }));
}
