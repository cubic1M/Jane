import { DETECTOR_RATES as R } from "@/config/detectors";
import {
  AUTO_AVERAGE,
  AUTO_PREMIUM_WORDS,
  FED_RATES,
  NETFLIX_PLANS,
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
import { evidence, factEvidence, headlineOf, nice, weakest } from "./helpers";
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
      "To look into it yourself: add up what your things would cost to replace (a laptop, a phone, a bike), ask two or three insurers for a quote with the same limit and deductible, and ask a parent whether their home policy reaches you while you're at school.";
    return suggestion("insurance", "belongings_cover", {
      title: stanford
        ? "Look into cover for your things: Stanford housing doesn't insure them"
        : "Look into cover for your things: a landlord's policy covers the building, not them",
      headline: headlineOf("Check cover for your things", R.rentersContentsCents, "risk"),
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
      title: "Get car insurance quotes yourself: you pay above the US average",
      headline: headlineOf("Get car insurance quotes yourself", above, "saves"),
      short: `You pay about ${formatCents(yearly)} a year to ${insurer}; the US average was ${formatWholeDollars(average)}.`,
      worthCents: above,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, paid.length, "car-cover charges"),
        // An average isn't a quote: cover, car, record and place all move the price.
        { percent: 45, reason: "an average isn't a quote for your car, cover and record" },
      ]),
      urgency: "later",
      why: `You pay ${insurer} about ${formatCents(yearly)} a year for car cover. The NAIC's average car insurance spending in the US was ${formatWholeDollars(average)} in ${AUTO_AVERAGE.year} (via the Insurance Information Institute), ${formatCents(above)} less, though your car, cover, driving record and where you live all move the price. To look into it yourself: find your declarations page for your limits and deductibles, ask two or three insurers for a quote with the same ones before your renewal date, and ask your own insurer which discounts you aren't getting.`,
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
      title: "Ask your card company for a lower rate: yours is above the average",
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
      why: `Your bank reports ${formatRate(top.aprBps)} on ${formatCents(owed)} of card balance. The Federal Reserve's latest average for bank cards charging interest was ${formatRate(FED_RATES.cardBps)} (${FED_RATES.month}); at that rate the same balance would cost about ${formatCents(extra)} a year less, and the average for a 24-month personal loan at banks was ${formatRate(FED_RATES.personalLoanBps)}. To look into it yourself: call the number on your card, say you pay on time and ask whether they can lower your rate, and write down what they say.`,
      action: { label: "Cut your card interest", href: "/loans/interest" },
      more: [{ label: "The Federal Reserve's rates (G.19)", href: FED_RATES.url }],
    });
  },
};

export const COVER_FACT_DETECTORS: readonly Detector[] = [belongingsCover, carCoverCost];
export const LOAN_FACT_DETECTORS: readonly Detector[] = [cardRateCheck];

// A Netflix plan above the one with ads: the service's own cheaper plan, as its page prices it.
const cheaperTier: Detector = {
  capability: "subscriptions",
  topic: "cheaper_tier",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const since = addDays(data.today, -45);
    const charges = data.transactions
      .filter(
        (t) =>
          t.amountCents > 0 &&
          t.date <= data.today &&
          NETFLIX_PLANS.words.test(lineOf(t)) &&
          !(t.pfc ?? "").startsWith("TRANSFER"),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const latest = charges[0];
    if (!latest || latest.date < since) return null;
    const ads = NETFLIX_PLANS.withAdsCents;
    if (latest.amountCents <= Math.round(ads * NETFLIX_PLANS.taxRoom)) return null;
    const yearly = (latest.amountCents - ads) * 12;
    return suggestion("subscriptions", "cheaper_tier", {
      title: "Look at Netflix's plan with ads: it costs less than yours",
      headline: headlineOf("Try Netflix's plan with ads", yearly, "saves"),
      short: `You pay Netflix ${formatCents(latest.amountCents)} a month; its plan with ads is ${formatCents(ads)}.`,
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, charges.length, "Netflix charges"),
        // Whether ads, and one plan's screens and quality, suit them is theirs to say.
        { percent: 60, reason: "whether ads and that plan's screens suit you is yours to say" },
      ]),
      urgency: "later",
      why: `You paid Netflix ${formatCents(latest.amountCents)} on ${dayLabel(latest.date)}. Netflix's own page lists Standard with ads at ${formatCents(ads)} a month in the US, about ${formatCents(yearly)} a year less than you pay now; its plans differ in ads, screens at once and picture quality. To change it: in Netflix, open Account, then Change plan, and pick the one you want; the new price starts at your next billing date.`,
      action: { label: "See my subscriptions", href: "/subscriptions" },
      more: [{ label: "Netflix's plans and prices", href: NETFLIX_PLANS.url }],
      watch: {
        kind: "bill_drops",
        payees: [{ description: latest.description, beforeCents: latest.amountCents, perYear: 12 }],
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
      title: "Look at T-Mobile's cheaper plan: one line costs less than your bill",
      headline: headlineOf("Look at T-Mobile's cheaper plan", yearly, "saves"),
      short: `You paid T-Mobile ${formatCents(latest.amountCents)}; its cheapest plan is ${formatCents(p.cheapestCents)} a line with AutoPay.`,
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, bills.length, "T-Mobile bills"),
        // Lines, a phone being paid off and the plan's perks aren't in the statement.
        { percent: 55, reason: "I can't see your lines, a phone payment, or your plan's perks" },
      ]),
      urgency: "later",
      why: `You paid T-Mobile ${formatCents(latest.amountCents)} on ${dayLabel(latest.date)}. T-Mobile's own plans page lists T-Mix Standard at ${formatCents(p.cheapestCents)} a month for one line with AutoPay (${formatCents(p.cheapestCents + p.autopayCents)} without), plus taxes and fees; its dearer plans add perks. Even with taxes that's about ${formatCents(yearly)} a year under your bill, if it's one line with no phone being paid off on it. To look into it: in the T-Mobile app or at t-mobile.com, open your plan, compare it with T-Mix Standard, and switch there if the perks you'd lose don't matter to you.`,
      action: { label: "See your bills", href: "/bills" },
      more: [{ label: "T-Mobile's plans", href: p.url }],
      watch: {
        kind: "bill_drops",
        payees: [{ description: latest.description, beforeCents: latest.amountCents, perYear: 12 }],
      },
    });
  },
};

export const BILL_FACT_DETECTORS: readonly Detector[] = [cheaperTier, phonePlanCheaper];
