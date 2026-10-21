import {
  ASSUMED_APTC_MONTHLY_CENTS,
  ASSUMED_BENCHMARK_MONTHLY_CENTS,
  MARKETPLACE_PAYEE,
} from "@/config/health-taxes";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadProfileInput } from "@/lib/profile";
import { CONTRIBUTION_LIMITS } from "@/config/tax-rates";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { hsaExcess, medicalDeduction, ptcCheck, type PtcCheck } from "@/planning/health-taxes";

// The tax side of health insurance (spec step 269), from the person's own accounts and what
// they told Jane: a Marketplace premium tax credit checked against their real income (so a
// mid-year rise that passes the line is caught before it becomes a bill), HSA contributions over
// the limit, and the medical deduction against its floor. Facts for everyone; recommendations
// are demo advice.

type Options = { client?: PrismaClient; now?: Date };

export type HealthTaxView = {
  year: number;
  advice: boolean;
  marketplace: {
    // Premiums to the Marketplace seen this year.
    payments: number;
    // The advance credit and the benchmark premium, told or assumed (assumed when null).
    advanceMonthlyCents: number;
    benchmarkMonthlyCents: number;
    told: boolean;
    householdSize: number;
    incomeCents: number;
    check: PtcCheck | null;
  };
  hsa: {
    contributedCents: number;
    limitCents: number;
    excessCents: number;
    exciseCents: number;
    taxCents: number;
  };
  medical: {
    spentCents: number;
    floorCents: number;
    deductibleCents: number;
    // The standard deduction is bigger than everything that could be itemized, so it won't count.
    itemizing: boolean;
  };
};

export async function loadHealthTaxes(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<HealthTaxView> {
  const [input, estimate] = await Promise.all([
    loadProfileInput(userId, { client, now }),
    loaded ? Promise.resolve(loaded.estimate) : loadTaxEstimate(userId, { client, now }),
  ]);
  const year = estimate.year;
  const inYear = input.transactions.filter((t) => t.date.startsWith(String(year)));
  const premiums = inYear.filter((t) => t.amountCents > 0 && MARKETPLACE_PAYEE.test(t.description));
  const est = estimate.estimate;
  const status = estimate.input.filingStatus;
  const size =
    (status === "married_joint" ? 2 : 1) +
    estimate.input.childrenUnder17 +
    estimate.input.otherDependants;
  const told = (k: "marketplace_aptc_monthly" | "marketplace_benchmark_monthly") =>
    typeof input.told[k] === "number" ? (input.told[k] as number) : null;
  const aptc = told("marketplace_aptc_monthly");
  const bench = told("marketplace_benchmark_monthly");
  const enrolled = premiums.length > 0;
  const advanceMonthly = aptc ?? ASSUMED_APTC_MONTHLY_CENTS;
  const benchmarkMonthly = bench ?? ASSUMED_BENCHMARK_MONTHLY_CENTS;
  const check = enrolled
    ? ptcCheck({
        incomeCents: est.agiCents,
        householdSize: size,
        benchmarkYearCents: benchmarkMonthly * 12,
        advanceYearCents: advanceMonthly * 12,
      })
    : null;

  const hsaIds = new Set(input.accounts.filter((a) => a.subtype === "hsa").map((a) => a.id));
  const contributed = inYear
    .filter((t) => hsaIds.has(t.accountId) && t.amountCents < 0)
    .reduce((s, t) => s - t.amountCents, 0);
  const family = status === "married_joint" || size > 1;
  const limit = family ? CONTRIBUTION_LIMITS.hsaFamily : CONTRIBUTION_LIMITS.hsaSelf;
  const excess = hsaExcess({
    contributedCents: contributed,
    limitCents: limit,
    marginalRate: est.marginalRate,
  });

  const spent = inYear
    .filter((t) => t.amountCents > 0 && (t.pfc ?? "").startsWith("MEDICAL_"))
    .reduce((s, t) => s + t.amountCents, 0);
  const med = medicalDeduction({ medicalCents: spent, agiCents: est.agiCents });
  return {
    year,
    advice: loaded?.advice ?? true,
    marketplace: {
      payments: premiums.length,
      advanceMonthlyCents: advanceMonthly,
      benchmarkMonthlyCents: benchmarkMonthly,
      told: aptc !== null && bench !== null,
      householdSize: size,
      incomeCents: est.agiCents,
      check,
    },
    hsa: { contributedCents: contributed, limitCents: limit, ...excess },
    medical: {
      spentCents: spent,
      floorCents: med.floorCents,
      deductibleCents: med.deductibleCents,
      itemizing: est.deduction.itemizedCents > est.deduction.standardCents,
    },
  };
}
