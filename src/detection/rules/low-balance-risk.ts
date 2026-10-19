import {
  FORECAST_DAYS,
  LOW_BALANCE_CUSHION_CENTS,
  LOW_BALANCE_HIGH_CONFIDENCE_BELOW_CENTS,
} from "@/config/detection";
import { formatCents } from "@/lib/money";
import { forecastAccounts } from "../forecast";
import type { Rule } from "./rule";
import { dayLabel } from "@/lib/day-label";

// A checking account forecast to fall below the cushion in the next FORECAST_DAYS, from
// its balance today, its recurring bills and its recurring income. No dollar estimate:
// the help is timing (moving due dates), not a saving.
export const lowBalanceRisk: Rule = (input) =>
  forecastAccounts(input, FORECAST_DAYS)
    .filter((f) => f.lowest.balanceCents < LOW_BALANCE_CUSHION_CENTS)
    .map((f) => ({
      type: "low_balance_risk",
      key: `account:${f.accountId}`,
      title: `${f.accountName} could drop to ${formatCents(f.lowest.balanceCents)} around ${dayLabel(f.lowest.date)}`,
      annualSavingsCents: null,
      amountCents: f.lowest.balanceCents,
      confidence:
        f.lowest.balanceCents < LOW_BALANCE_HIGH_CONFIDENCE_BELOW_CENTS ? "high" : "medium",
      evidence: {
        accountId: f.accountId,
        accountName: f.accountName,
        balanceCents: f.startCents,
        lowestCents: f.lowest.balanceCents,
        lowestDate: f.lowest.date,
        cushionCents: LOW_BALANCE_CUSHION_CENTS,
        bills: f.bills
          .filter((b) => b.date <= f.lowest.date)
          .map((b) => ({ merchant: b.merchant, date: b.date, amountCents: b.amountCents })),
        income: f.income.map((i) => ({
          merchant: i.merchant,
          date: i.date,
          amountCents: i.amountCents,
        })),
      },
    }));
