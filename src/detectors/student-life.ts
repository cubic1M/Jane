import {
  CARDINAL_CARE,
  DEVICE_PLANS,
  FREE_SERVICE_SEEN_DAYS,
  FREE_SERVICE_YEARLY_FROM_CENTS,
  GRAD_GOPASS,
  HEALTH_PREMIUM_MIN,
  HEALTH_PREMIUM_ONCE_FROM_CENTS,
  HEALTH_PREMIUM_WORDS,
  STANFORD_FREE,
} from "@/config/student-money";
import { addDays, daysBetween } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import type { Profile, ProfileInput, ProfileTx } from "@/profile/build";
import { type Detector, suggestion } from "./contract";
import { clip, evidence, factEvidence, headlineOf, listOf, nice, weakest } from "./helpers";
import { atStanford } from "./student-money";

// Student life (suggest-money lane, 11-18): what Stanford gives its people free that the person
// pays for, the free Caltrain pass for graduate students, Cardinal Care beside another health
// plan, and two plans protecting one phone. Facts from Stanford's own pages
// (src/config/student-money.ts); no plan is picked over another. Pure; see ./contract.ts.

const lineOf = (t: ProfileTx) => `${t.merchantName ?? ""} ${t.description}`.toUpperCase();

// Someone Stanford counts as its own: paid by Stanford University, or a student whose lines name
// the university. A parent paying a Stanford bill is neither.
function stanfordPerson(profile: Profile, data: ProfileInput): boolean {
  if (!atStanford(data)) return false;
  const paidBy = data.transactions.some(
    (t) =>
      t.amountCents < 0 && (t.pfc ?? "").startsWith("INCOME") && /\bSTANFORD\b/.test(lineOf(t)),
  );
  return paidBy || profile.facts.is_student.value === true;
}

// A Stanford student, for what only students get: told or seen, and Stanford in the data.
const stanfordStudent = (profile: Profile, data: ProfileInput) =>
  profile.facts.is_student.value === true && atStanford(data);

// Charges matching `words` lately, newest first, and what they come to a year: monthly when they
// repeat within about a month, a year's when they're a year apart, and one charge read by its size.
function paidFor(data: ProfileInput, words: RegExp, notWords: RegExp | null = null) {
  const since = addDays(data.today, -FREE_SERVICE_SEEN_DAYS);
  const txs = data.transactions
    .filter((t) => {
      const line = lineOf(t);
      return (
        t.amountCents > 0 &&
        t.date >= since &&
        t.date <= data.today &&
        words.test(line) &&
        !(notWords?.test(line) ?? false)
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = txs[0];
  if (!latest) return null;
  const second = txs[1];
  const gap = second ? daysBetween(second.date, latest.date) : null;
  const monthly = gap !== null ? gap <= 45 : latest.amountCents < FREE_SERVICE_YEARLY_FROM_CENTS;
  return { txs, latest, yearlyCents: monthly ? latest.amountCents * 12 : latest.amountCents };
}

const freeThroughStanford: Detector = {
  capability: "subscriptions",
  topic: "free_through_school",
  covers: [],
  needs: ["is_student"],
  detect({ profile, data }) {
    if (!stanfordPerson(profile, data)) return null;
    const paying = STANFORD_FREE.flatMap((s) => {
      const p = paidFor(data, s.words, s.notWords);
      return p ? [{ ...s, ...p }] : [];
    });
    if (paying.length === 0) return null;
    const yearly = paying.reduce((n, p) => n + p.yearlyCents, 0);
    const names = paying.map((p) => p.name);
    const all =
      names.length <= 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    const charges = paying.reduce((n, p) => n + p.txs.length, 0);
    return suggestion("subscriptions", "free_through_school", {
      title: `Use Stanford's free ${all} instead of paying`,
      headline: headlineOf(
        paying.length === 1
          ? `Get ${paying[0]!.name} free via Stanford`
          : "Get these free via Stanford",
        yearly,
        "saves",
      ),
      short: clip(
        `You pay for ${all}; Stanford gives ${paying.length === 1 ? "it" : "them"} to its people free.`,
      ),
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, charges, "charges"),
        ...(profile.facts.is_student.value === true
          ? [factEvidence(profile.facts.is_student)]
          : []),
      ]),
      urgency: "soon",
      why: `${paying.map((p) => `You paid ${p.name} ${formatCents(p.latest.amountCents)} on ${dayLabel(p.latest.date)}`).join("; ")}: about ${formatCents(yearly)} a year. Stanford gives ${all} to its students, faculty and staff free. To switch: ${paying.map((p) => `for ${p.name}, ${p.how}`).join("; ")}; then cancel the paid one before its next charge.`,
      action: { label: "See Stanford's free access", href: paying[0]!.url },
      more: [...new Set(paying.map((p) => p.url))]
        .slice(1)
        .map((href) => ({ label: "Stanford's free software", href })),
      watch: {
        kind: "charge_stops",
        payees: paying.map((p) => ({
          description: p.latest.description,
          amountCents: p.latest.amountCents,
          perYear: p.yearlyCents === p.latest.amountCents ? 1 : 12,
        })),
      },
    });
  },
};

const gradGoPass: Detector = {
  capability: "cost",
  topic: "transit_pass",
  covers: [],
  needs: ["is_student"],
  detect({ profile, data }) {
    if (!stanfordStudent(profile, data) || data.today > GRAD_GOPASS.until) return null;
    const since = addDays(data.today, -90);
    const fares = data.transactions.filter(
      (t) =>
        t.amountCents > 0 &&
        t.date >= since &&
        t.date <= data.today &&
        GRAD_GOPASS.words.test(lineOf(t)),
    );
    if (fares.length < GRAD_GOPASS.minFares) return null;
    const spent = fares.reduce((n, t) => n + t.amountCents, 0);
    const first = fares.reduce((m, t) => (t.date < m ? t.date : m), data.today);
    const days = Math.max(30, daysBetween(first, data.today));
    const yearly = Math.round((spent * 365) / days);
    return suggestion("cost", "transit_pass", {
      title: "Ask for Stanford's free Caltrain pass if you're a graduate student living off campus",
      headline: headlineOf("Get the free Caltrain GoPass", yearly, "saves"),
      short: `You paid ${formatCents(spent)} in ${fares.length} Caltrain fares since ${dayLabel(first)}.`,
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(profile.facts.is_student),
        evidence("seen", profile.months, fares.length, "Caltrain fares"),
        // Whether they're a graduate student living off campus isn't in the data.
        { percent: 55, reason: "it's for graduate students living off campus, which I can't see" },
      ]),
      urgency: "soon",
      why: `You paid ${formatCents(spent)} in ${fares.length} Caltrain fares since ${dayLabel(first, { long: true })}, about ${formatCents(yearly)} a year at that pace. Stanford gives a Caltrain GoPass free to an active, degree-seeking graduate student whose home isn't in 94304, 94305 or 94309 and is within commuting range; the program runs through August 2027. Undergraduates aren't eligible. To do it: fill in Stanford's Graduate Student Caltrain GoPass form with your Clipper card's number (a phone's Clipper card works), and the pass is loaded onto it.`,
      action: { label: "Request the GoPass", href: GRAD_GOPASS.formUrl },
      more: [{ label: "Stanford's GoPass page", href: GRAD_GOPASS.url }],
    });
  },
};

const cardinalCareCheck: Detector = {
  capability: "insurance",
  topic: "cardinal_care_check",
  covers: [],
  needs: ["is_student"],
  detect({ profile, data }) {
    if (!stanfordStudent(profile, data)) return null;
    const since = addDays(data.today, -120);
    const premiums = data.transactions
      .filter(
        (t) =>
          t.amountCents > 0 &&
          t.date >= since &&
          t.date <= data.today &&
          HEALTH_PREMIUM_WORDS.test(lineOf(t)) &&
          !(t.pfc ?? "").startsWith("MEDICAL"),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    if (premiums.length < HEALTH_PREMIUM_MIN) return null;
    const latest = premiums[0]!;
    const plan = nice(latest.description);
    const monthly = premiums.length >= 2 || latest.amountCents < HEALTH_PREMIUM_ONCE_FROM_CENTS;
    const yearly = monthly ? latest.amountCents * 12 : latest.amountCents;
    const worth = Math.min(yearly, CARDINAL_CARE.yearCents);
    const open = CARDINAL_CARE.windows.find((w) => w.from <= data.today && w.to >= data.today);
    const next = CARDINAL_CARE.windows.find((w) => w.from > data.today);
    const window = open
      ? `The waiver window open now is for ${open.who}: ${dayLabel(open.from)} to ${dayLabel(open.to, { long: true })}, with a decision within 10 business days.`
      : next
        ? `The next waiver window is for ${next.who}: ${dayLabel(next.from)} to ${dayLabel(next.to)}.`
        : "";
    return suggestion("insurance", "cardinal_care_check", {
      title: "Check you aren't paying for Cardinal Care and another health plan",
      headline: headlineOf("Check you don't pay two health plans", worth, "saves"),
      short: `You pay ${plan} ${formatCents(latest.amountCents)}${monthly ? " a month" : ""}; Cardinal Care is ${formatWholeDollars(CARDINAL_CARE.yearCents)} a year.`,
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(profile.facts.is_student),
        evidence("seen", profile.months, premiums.length, "health plan payments"),
        // The Stanford bill, where Cardinal Care is charged, isn't in the data.
        { percent: 40, reason: "I can't see whether Cardinal Care is on your Stanford bill" },
      ]),
      urgency: open ? "now" : "later",
      why: `You pay ${plan} ${formatCents(latest.amountCents)}${monthly ? " a month" : ""}, about ${formatCents(yearly)} a year. Stanford enrolls its students in Cardinal Care, ${formatWholeDollars(CARDINAL_CARE.yearCents)} for 2026-27, unless they waive it with a plan that meets its rules: Minimum Essential Coverage, a deductible and an out-of-pocket maximum of ${formatWholeDollars(CARDINAL_CARE.maxDeductibleCents)} or less for one person, and inpatient and outpatient care in the Bay Area (short-term, travel and dental-only plans don't count). Your Stanford bill shows whether Cardinal Care is on it. ${window} Continuing students waive in the autumn window, which ran ${dayLabel(CARDINAL_CARE.windows[0].from)} to ${dayLabel(CARDINAL_CARE.windows[0].to)} this year. Stanford pays all of Cardinal Care for a graduate student on an assistantship of 25% or more who hasn't waived it, and half for one under 25%.`,
      action: { label: "See Cardinal Care's waiver rules", href: CARDINAL_CARE.waiverUrl },
      more: [{ label: "Cardinal Care's cost and subsidy", href: CARDINAL_CARE.costUrl }],
    });
  },
};

const deviceCoverTwice: Detector = {
  capability: "insurance",
  topic: "device_cover_twice",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const since = addDays(data.today, -75);
    const plans = DEVICE_PLANS.flatMap((p) => {
      const txs = data.transactions
        .filter(
          (t) =>
            t.amountCents > 0 && t.date >= since && t.date <= data.today && p.words.test(lineOf(t)),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      return txs[0] ? [{ ...p, txs, latest: txs[0] }] : [];
    });
    if (plans.length < 2) return null;
    const cheapest = plans.reduce((a, b) => (b.latest.amountCents < a.latest.amountCents ? b : a));
    const yearly = cheapest.latest.amountCents * 12;
    const named = plans.map((p) => p.latest.description);
    return suggestion("insurance", "device_cover_twice", {
      title: "Check whether two plans protect the same phone",
      headline: headlineOf("Drop a second phone protection plan", yearly, "saves"),
      short: clip(`You pay for ${listOf(named)} each month.`),
      worthCents: yearly,
      worthKind: "saves",
      confidence: weakest([
        evidence(
          "seen",
          profile.months,
          plans.reduce((n, p) => n + p.txs.length, 0),
          "protection charges",
        ),
        { percent: 60, reason: "I can't see which device each plan covers" },
      ]),
      urgency: "later",
      why: `You pay ${plans.map((p) => `${nice(p.latest.description)} ${formatCents(p.latest.amountCents)}`).join(" and ")} a month. If both cover the same phone, you're paying twice for it: the cheaper is about ${formatCents(yearly)} a year. To check: look at each plan's account for the device it names, and if both name the same one, cancel one there; the other keeps the phone covered.`,
      action: { label: "See your subscriptions", href: "/subscriptions" },
      watch: {
        kind: "charge_stops",
        payees: [
          {
            description: cheapest.latest.description,
            amountCents: cheapest.latest.amountCents,
            perYear: 12,
          },
        ],
      },
    });
  },
};

export const STUDENT_LIFE_DETECTORS: readonly Detector[] = [
  freeThroughStanford,
  gradGoPass,
  cardinalCareCheck,
  deviceCoverTwice,
];
