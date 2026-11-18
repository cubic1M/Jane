import { DETECTOR_RATES as R } from "@/config/detectors";
import {
  AUTO_AVERAGE,
  AUTO_PREMIUM_WORDS,
  FED_RATES,
  CHEAPER_PLAN_SEEN_DAYS,
  DIRECT_DEPOSIT_WORDS,
  FEE_WAIVERS,
  MONTHLY_FEE_SEEN_DAYS,
  MONTHLY_FEE_WORDS,
  CHEAPER_PLAN_TAX_ROOM,
  CHEAPER_PLANS,
  TMOBILE_PLANS,
  RENTERS_AVERAGE,
  STANFORD_HOUSING,
} from "@/config/student-money";
import { addDays, daysBetween } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { formatRate } from "@/lib/percent";
import type { ProfileTx } from "@/profile/build";
import { type Detector, suggestion } from "./contract";
import { clip, evidence, factEvidence, headlineOf, nice, weakest } from "./helpers";
import { atStanford } from "./student-money";

// Facts for real accounts where the recommendation is demo advice only (suggest-money lane, phase
// 2, 11-18): what Jane sees, the published figure beside it with its source, and the person's own
// steps to look into it. No insurer, lender or product is named as the choice and nothing says
// what to buy. The demo person also gets the fuller advice card; both share a money group
// (src/config/suggestions.ts), so one shows. Pure; see ./contract.ts.

const lineOf = (t: ProfileTx) => `${t.merchantName ?? ""} ${t.description}`.toUpperCase();

// Belongings with no cover: a renter with no renters-cover charge, or a Stanford student with no
// rent seen (most live in Stanford housing, whose agreement says the university doesn't insure
// their things).
const belongingsCover: Detector = {
  capability: "insurance",
  topic: "belongings_cover",
  covers: ["insurance_policies"],
  needs: ["housing", "insurance_home"],
  detect({ profile, data }) {
    const housing = profile.facts.housing;
    const cover = profile.facts.insurance_home;
    if (cover.value === true || profile.facts.debt_trouble.value === true) return null;
    const renting = housing.value === "rent";
    const stanford =
      !renting &&
      housing.value !== "own" &&
      profile.facts.is_student.value === true &&
      atStanford(data);
    if (!renting && !stanford) return null;
    const state = data.state ?? null;
    const average = (state && RENTERS_AVERAGE.byState[state]) || RENTERS_AVERAGE.usCents;
    const where =
      state && RENTERS_AVERAGE.byState[state]
        ? `in ${state === "CA" ? "California" : state}`
        : "in the US";
    const averageLine = `In ${RENTERS_AVERAGE.year}, the latest year published, the average renters policy ${where} cost ${formatWholeDollars(average)} a year (the NAIC's figure, via the Insurance Information Institute).`;
    const steps =
      "What a quote turns on: what your things would cost to replace (a laptop, a phone, a bike), the limit and the deductible; quotes from two or three insurers for the same ones compare like with like, and a parent's insurer can say whether their home policy reaches a student at school.";
    return suggestion("insurance", "belongings_cover", {
      title: stanford
        ? "Stanford housing doesn't insure your things, and I see no renters cover"
        : "A landlord's policy covers the building, not your things, and I see no renters cover",
      headline: "Note your things have no renters cover",
      // Ranked by what's at risk (renters_insurance's typical contents figure), never shown as one.
      factOnly: true,
      short: stanford
        ? "Stanford doesn't insure students' belongings in its housing; I see no renters cover."
        : `You rent and I see no renters-cover charge in ${profile.months} months.`,
      worthCents: R.rentersContentsCents,
      worthKind: "risk",
      confidence: weakest([
        ...(stanford ? [factEvidence(profile.facts.is_student)] : [factEvidence(housing)]),
        evidence("seen", profile.months, 0, "renters-cover charges"),
        // A parent's policy or one paid another way can't be seen.
        { percent: 60, reason: "cover paid some other way, or a parent's, wouldn't show here" },
      ]),
      urgency: "later",
      why: `${
        stanford
          ? "I see Stanford in your payments and no rent, so you may live in Stanford housing. Stanford's residence agreement says the university doesn't carry insurance on residents' belongings and calls it advisable to get your own renter's insurance; residents also answer for damage to university property in their rooms."
          : `You pay rent and I see no renters-cover charge in ${profile.months} months. A landlord's policy covers the building, not the things inside it.`
      } ${averageLine} ${steps} If you're already covered, tell me and I'll stop.`,
      action: { label: "See your cover", href: "/insurance" },
      more: [
        ...(stanford
          ? [{ label: "Stanford's residence agreement", href: STANFORD_HOUSING.url }]
          : []),
        { label: "Average renters premiums", href: RENTERS_AVERAGE.url },
      ],
    });
  },
};

// Car cover above the US average: what the person pays a year against the NAIC's average, as a
// reason to get quotes themselves before it renews. Not a quote and not a pick.
const carCoverCost: Detector = {
  capability: "insurance",
  topic: "car_cover_cost",
  covers: ["insurance_quotes"],
  needs: ["insurance_auto"],
  detect({ profile, data }) {
    const paid = data.transactions.filter(
      (t) => t.amountCents > 0 && t.date <= data.today && AUTO_PREMIUM_WORDS.test(lineOf(t)),
    );
    if (paid.length < 2) return null;
    // A year of it: the last 12 months summed when the data reaches back a year; else the latest
    // charge at its own rhythm (monthly, every six months, or once a year).
    const yearAgo = addDays(data.today, -365);
    const sorted = [...paid].sort((a, b) => b.date.localeCompare(a.date));
    const first = data.transactions.reduce((m, t) => (t.date < m ? t.date : m), data.today);
    const gap = daysBetween(sorted[1]!.date, sorted[0]!.date);
    const yearly =
      first <= yearAgo
        ? sorted.filter((t) => t.date > yearAgo).reduce((s, t) => s + t.amountCents, 0)
        : sorted[0]!.amountCents * (gap <= 45 ? 12 : gap <= 200 ? 2 : 1);
    const average = AUTO_AVERAGE.usCents;
    if (yearly < average * (1 + AUTO_AVERAGE.aboveShare)) return null;
    const above = yearly - average;
    const insurer = nice(paid[paid.length - 1]!.description);
    return suggestion("insurance", "car_cover_cost", {
      title: "Your car cover costs more than the US average",
      // The gap to an average, not a quote: said as a fact, with the figure.
      headline: `Note car cover ${formatWholeDollars(above)} a year above US average`,
      short: `You pay about ${formatCents(yearly)} a year to ${insurer}; the US average was ${formatWholeDollars(average)}.`,
      // The gap to the US average: what's at stake in comparing, at most 45% sure.
      worthCents: above,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, paid.length, "car-cover charges"),
        // An average isn't a quote: cover, car, record and place all move the price.
        { percent: 45, reason: "an average isn't a quote for your car, cover and record" },
      ]),
      urgency: "later",
      why: `You pay ${insurer} about ${formatCents(yearly)} a year for car cover. The NAIC's average car insurance spending in the US was ${formatWholeDollars(average)} in ${AUTO_AVERAGE.year} (via the Insurance Information Institute), ${formatCents(above)} less, though your car, cover, driving record and where you live all change the price. To look into it yourself: find your declarations page for your limits and deductibles, ask two or three insurers for a quote with the same ones before your renewal date, and ask your own insurer whether any discounts apply that you don't have.`,
      action: { label: "See your cover", href: "/insurance" },
      more: [{ label: "Average car insurance spending", href: AUTO_AVERAGE.url }],
    });
  },
};

// A card's rate above the Fed's average for cards charging interest: worth a call to the issuer.
const cardRateCheck: Detector = {
  capability: "debt",
  topic: "card_rate_check",
  covers: ["card_interest"],
  needs: [],
  detect({ profile, data }) {
    const cards = data.liabilities.flatMap((l) => {
      if (l.kind !== "credit" || typeof l.aprBps !== "number") return [];
      const a = data.accounts.find((x) => x.id === l.accountId);
      if (!a || a.balanceKnown === false) return [];
      const owed = Math.abs(a.balanceCents);
      return owed >= FED_RATES.minBalanceCents && l.aprBps >= FED_RATES.cardBps + FED_RATES.aboveBps
        ? [{ owed, aprBps: l.aprBps, name: a.name ?? "your card" }]
        : [];
    });
    if (cards.length === 0) return null;
    const owed = cards.reduce((n, c) => n + c.owed, 0);
    const extra = cards.reduce(
      (n, c) => n + Math.round((c.owed * (c.aprBps - FED_RATES.cardBps)) / 10_000),
      0,
    );
    const top = cards.reduce((a, b) => (b.aprBps > a.aprBps ? b : a));
    return suggestion("debt", "card_rate_check", {
      title: "Your card's rate is above the Federal Reserve's average",
      headline: headlineOf("Ask for a lower card rate", extra, "saves"),
      short: `Your card charges ${formatRate(top.aprBps)} on ${formatCents(owed)}; the average was ${formatRate(FED_RATES.cardBps)}.`,
      worthCents: extra,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, cards.length, "card rates from your bank"),
        // Whether the issuer lowers it is up to them.
        { percent: 50, reason: "whether the card company lowers it is up to them" },
      ]),
      urgency: "later",
      why: `Your bank reports ${formatRate(top.aprBps)} on ${formatCents(owed)} of card balance. The Federal Reserve's latest average for bank cards charging interest was ${formatRate(FED_RATES.cardBps)} (${FED_RATES.month}); at that rate the same balance would cost about ${formatCents(extra)} a year less. To look into it yourself: call the number on your card, ask whether they can lower your rate (if you've paid on time, say so), and write down what they say.`,
      action: { label: "Cut your card interest", href: "/loans/interest" },
      more: [{ label: "The Federal Reserve's rates (G.19)", href: FED_RATES.url }],
    });
  },
};

export const COVER_FACT_DETECTORS: readonly Detector[] = [belongingsCover, carCoverCost];
export const LOAN_FACT_DETECTORS: readonly Detector[] = [cardRateCheck];

// A service paid above its own cheaper plan (Netflix with ads, ChatGPT Go): the cheaper plan as
// the service's page prices it, and where it's listed. One card for all of them.
const cheaperTier: Detector = {
  capability: "subscriptions",
  topic: "cheaper_tier",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const since = addDays(data.today, -CHEAPER_PLAN_SEEN_DAYS);
    const found = CHEAPER_PLANS.flatMap((p) => {
      const charges = data.transactions
        .filter(
          (t) =>
            t.amountCents > 0 &&
            t.date <= data.today &&
            p.words.test(lineOf(t)) &&
            !(t.pfc ?? "").startsWith("TRANSFER"),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      const latest = charges[0];
      if (!latest || latest.date < since) return [];
      if (latest.amountCents <= Math.round(p.cents * CHEAPER_PLAN_TAX_ROOM)) return [];
      return [{ ...p, latest, count: charges.length, yearly: (latest.amountCents - p.cents) * 12 }];
    });
    if (found.length === 0) return null;
    const yearly = found.reduce((n, f) => n + f.yearly, 0);
    const one = found.length === 1 ? found[0]! : null;
    return suggestion("subscriptions", "cheaper_tier", {
      title: one
        ? `${one.service} lists a cheaper plan than the one you pay for`
        : `${found.map((f) => f.service).join(" and ")} list cheaper plans than the ones you pay for`,
      headline: headlineOf(
        one ? `Note ${one.service}'s ${one.plan} plan` : "Note cheaper plans of what you pay",
        yearly,
        "saves",
      ),
      short: clip(
        found
          .map(
            (f) =>
              `${f.service}: you pay ${formatCents(f.latest.amountCents)}, ${f.plan} is ${formatCents(f.cents)}`,
          )
          .join("; ") + ".",
      ),
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        evidence(
          "seen",
          profile.months,
          found.reduce((n, f) => n + f.count, 0),
          "charges",
        ),
        // Whether the cheaper plan's limits suit them is theirs to say.
        { percent: 60, reason: "whether the cheaper plan's limits suit you is yours to say" },
      ]),
      urgency: "later",
      why: found
        .map(
          (f) =>
            `You paid ${f.service} ${formatCents(f.latest.amountCents)} on ${dayLabel(f.latest.date)}. ${f.service}'s own page lists ${f.plan} at ${formatCents(f.cents)} a month, about ${formatCents(f.yearly)} a year less than you pay now; its plans differ in ${f.differs}. ${f.where}.`,
        )
        .join(" "),
      action: { label: "See my subscriptions", href: "/subscriptions" },
      more: found.map((f) => ({ label: `${f.service}'s plans and prices`, href: f.url })),
      watch: {
        kind: "bill_drops",
        payees: found.map((f) => ({
          description: f.latest.description,
          beforeCents: f.latest.amountCents,
          perYear: 12,
        })),
      },
    });
  },
};

// A T-Mobile bill that looks like one line on a plan above T-Mix Standard: the carrier's own
// cheaper plan, as its plans page prices it.
const phonePlanCheaper: Detector = {
  capability: "cost",
  topic: "phone_plan_cheaper",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const p = TMOBILE_PLANS;
    const since = addDays(data.today, -45);
    const bills = data.transactions
      .filter((t) => {
        const line = lineOf(t);
        return (
          t.amountCents > 0 && t.date <= data.today && p.words.test(line) && !p.notWords.test(line)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    const latest = bills[0];
    if (!latest || latest.date < since) return null;
    const floor = Math.round(p.cheapestCents * p.taxRoom);
    if (latest.amountCents <= floor || latest.amountCents > p.oneLineMaxCents) return null;
    const yearly = (latest.amountCents - floor) * 12;
    return suggestion("cost", "phone_plan_cheaper", {
      title: "T-Mobile lists a one-line plan below your bill",
      headline: headlineOf("Note T-Mobile's cheapest plan", yearly, "saves"),
      short: `You paid T-Mobile ${formatCents(latest.amountCents)}; its cheapest plan is ${formatCents(p.cheapestCents)} a line with AutoPay.`,
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, bills.length, "T-Mobile bills"),
        // Lines, a phone being paid off and the plan's perks aren't in the statement.
        { percent: 55, reason: "I can't see your lines, a phone payment, or your plan's perks" },
      ]),
      urgency: "later",
      why: `You paid T-Mobile ${formatCents(latest.amountCents)} on ${dayLabel(latest.date)}. T-Mobile's own plans page lists T-Mix Standard at ${formatCents(p.cheapestCents)} a month for one line with AutoPay (${formatCents(p.cheapestCents + p.autopayCents)} without), plus taxes and fees; its dearer plans add perks. Even with taxes that's about ${formatCents(yearly)} a year under your bill, if it's one line with no phone being paid off on it. The T-Mobile app and t-mobile.com show your plan beside T-Mix Standard.`,
      action: { label: "See your bills", href: "/bills" },
      more: [{ label: "T-Mobile's plans", href: p.url }],
      watch: {
        kind: "bill_drops",
        payees: [{ description: latest.description, beforeCents: latest.amountCents, perYear: 12 }],
      },
    });
  },
};

// A checking account's monthly fee in a month when the person's own pay, deposited there, met the
// rule the bank's page gives for no fee: the account may be another type, or the deposit may not
// count; the bank can say which. The bank_fees card steps aside for it when it's the only fee
// (./money.ts): one $12 fee, two cards (debugger 11-18).
export function waivableFee(data: Parameters<Detector["detect"]>[0]["data"]): {
  w: (typeof FEE_WAIVERS)[number];
  fee: (typeof data.transactions)[number];
  accountIds: ReadonlySet<string>;
  total: number;
  paychecks: number;
} | null {
  const since = addDays(data.today, -MONTHLY_FEE_SEEN_DAYS);
  for (const w of FEE_WAIVERS) {
    const ids = new Set(
      data.accounts
        .filter(
          (a) =>
            a.type === "depository" &&
            w.words.test(`${a.institution ?? ""} ${a.name ?? ""}`.toUpperCase()),
        )
        .map((a) => a.id),
    );
    if (ids.size === 0) continue;
    const fee = data.transactions
      .filter(
        (t) =>
          ids.has(t.accountId) &&
          t.amountCents > 0 &&
          t.date >= since &&
          t.date <= data.today &&
          (t.pfc ?? "").startsWith("BANK_FEES") &&
          MONTHLY_FEE_WORDS.test(lineOf(t)),
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!fee) continue;
    // Pay deposited into the same account in the month before the fee.
    const from = addDays(fee.date, -31);
    const pay = data.transactions.filter(
      (t) =>
        ids.has(t.accountId) &&
        t.amountCents < 0 &&
        t.date > from &&
        t.date <= fee.date &&
        ((t.pfc ?? "").startsWith("INCOME") || DIRECT_DEPOSIT_WORDS.test(lineOf(t))),
    );
    const total = pay.reduce((n, t) => n - t.amountCents, 0);
    const biggest = pay.reduce((m, t) => Math.max(m, -t.amountCents), 0);
    const met =
      (w.singleCents !== null && biggest >= w.singleCents) ||
      (w.totalCents !== null && total >= w.totalCents);
    if (met) return { w, fee, accountIds: ids, total, paychecks: pay.length };
  }
  return null;
}

// Whether a fee is the monthly fee the waiver card speaks for.
export const isWaivableMonthlyFee = (
  t: ProfileTx,
  waivable: { accountIds: ReadonlySet<string> },
): boolean =>
  waivable.accountIds.has(t.accountId) &&
  (t.pfc ?? "").startsWith("BANK_FEES") &&
  MONTHLY_FEE_WORDS.test(lineOf(t));

const feeWaiverMet: Detector = {
  capability: "cost",
  topic: "fee_waiver_met",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const found = waivableFee(data);
    if (!found) return null;
    const { w, fee, total } = found;
    const yearly = fee.amountCents * 12;
    return suggestion("cost", "fee_waiver_met", {
      title: `${w.account} has no monthly fee with ${w.rule}, according to ${w.bank}'s page`,
      headline: headlineOf("Ask about your waivable bank fee", yearly, "saves"),
      short: clip(
        `${w.bank} charged a ${formatCents(fee.amountCents)} monthly fee on ${dayLabel(fee.date)}; ${formatCents(total)} in pay came in that month.`,
      ),
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, found.paychecks, "paychecks deposited"),
        // The account's type and what the bank counts as qualifying aren't in the statement.
        {
          percent: 55,
          reason: "your account's type and what the bank counts aren't in the statement",
        },
      ]),
      urgency: "soon",
      why: `Your ${w.bank} checking charged a ${formatCents(fee.amountCents)} monthly fee on ${dayLabel(fee.date, { long: true })}, and ${formatCents(total)} in pay was deposited there in the month before. ${w.account} has no monthly fee in a statement cycle with ${w.rule}, according to ${w.bank}'s own page. Your account may be another type, or a deposit may not count as qualifying; ${w.bank} can say which applies to yours.`,
      action: { label: `See ${w.bank}'s fee rules`, href: w.url },
      watch: {
        kind: "fee_stops",
        pfcs: [fee.pfc ?? "BANK_FEES_OTHER_BANK_FEES"],
        monthlyCents: fee.amountCents,
      },
    });
  },
};

export const BILL_FACT_DETECTORS: readonly Detector[] = [
  cheaperTier,
  phonePlanCheaper,
  feeWaiverMet,
];
