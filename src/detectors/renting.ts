import { RENT_REPORTING, RENT_REPORTING_RATE_BENEFIT_BPS } from "@/config/renting";
import { formatCents } from "@/lib/money";
import { enoughRent, rentPayments, rentRise } from "@/planning/renting";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, weakest } from "./helpers";

// Detectors for renting (spec step 248): rent that could build credit, and a rent increase set
// beside what is usual. Pure; see ./contract.ts.

const paymentsOf = (data: Parameters<Detector["detect"]>[0]["data"]) =>
  rentPayments(
    data.transactions.map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      pfc: t.pfc,
    })),
  );

// Rent paid on time for a year, not on the credit file, for someone who carries a balance
// where a better file would bring the rate down.
const rentReporting: Detector = {
  capability: "debt",
  topic: "rent_reporting",
  covers: ["renting"],
  needs: ["housing", "card_debt_cents"],
  detect({ profile, data }) {
    const housing = profile.facts.housing;
    if (housing.value !== "rent" || data.rentReportingOn === true) return null;
    const payments = paymentsOf(data);
    if (!enoughRent(payments)) return null;
    const owed = data.accounts
      .filter((a) => a.type === "credit" || a.type === "loan")
      .reduce((s, a) => s + Math.max(0, a.balanceCents), 0);
    const worth = Math.round((owed * RENT_REPORTING_RATE_BENEFIT_BPS) / 10_000);
    if (worth <= 0) return null;
    const rent = payments[payments.length - 1].cents;
    return {
      id: suggestionId("debt", "rent_reporting"),
      capability: "debt",
      topic: "rent_reporting",
      title: "Have your rent reported to the credit bureaus",
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(housing),
        evidence("seen", profile.months, payments.length, "rent payments"),
        { percent: 65, reason: "I can't tell whether your lenders count rent history" },
      ]),
      urgency: "later",
      why: `You pay ${formatCents(rent)} in rent every month and it isn't on your credit file. Reporting it can help your score, and on the ${formatCents(owed)} you owe a slightly better rate is worth about ${formatCents(worth)} a year. It costs about ${formatCents(RENT_REPORTING.monthlyFeeCents)} a month and only starts when you say yes.`,
      action: { label: "See rent reporting", href: "/loans/renting" },
    };
  },
};

// A rent that rose well past what is usual in a year.
const rentIncrease: Detector = {
  capability: "debt",
  topic: "rent_increase",
  covers: [],
  needs: ["housing"],
  detect({ profile, data }) {
    const housing = profile.facts.housing;
    if (housing.value !== "rent") return null;
    const payments = paymentsOf(data);
    const rise = rentRise(payments);
    if (!rise?.askAbout) return null;
    return {
      id: suggestionId("debt", "rent_increase"),
      capability: "debt",
      topic: "rent_increase",
      title: "Your rent went up more than is usual",
      worthCents: rise.yearlyExtraCents,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(housing),
        evidence("seen", profile.months, payments.length, "rent payments"),
        { percent: 70, reason: "the usual rise is a stand-in, not your landlord's market" },
      ]),
      urgency: "soon",
      why: `Your rent went from ${formatCents(rise.beforeCents)} to ${formatCents(rise.nowCents)} a month, ${formatCents(rise.yearlyExtraCents)} more a year and ${(rise.risePercentBps / 100).toFixed(1)}% against a usual ${(rise.usualBps / 100).toFixed(0)}%. It's worth asking your landlord whether it can be less.`,
      action: { label: "See your rent", href: "/loans/renting" },
    };
  },
};

export const RENTING_DETECTORS: readonly Detector[] = [rentReporting, rentIncrease];
