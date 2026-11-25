import { AID_PRIORITY, CLIPPER_START, STANFORD_AID_WORDS } from "@/config/student-money";
import { addDays, daysBetween } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import type { Profile, ProfileTx } from "@/profile/build";
import { type Detector, suggestion } from "./contract";
import { evidence, factEvidence, headlineOf, weakest } from "./helpers";
import { atStanford } from "./student-money";

// Benefits and dates a student may meet (suggest-money lane, 11-18): half-price Bay Area transit
// for a low income, and Stanford's aid priority date for an undergraduate getting aid. Each says
// "may qualify" and the rule, never that the person does; the official page decides. Pure; see
// ./contract.ts.

const lineOf = (t: ProfileTx) => `${t.merchantName ?? ""} ${t.description}`.toUpperCase();

const ageOf = (profile: Profile) =>
  typeof profile.facts.age.value === "number" ? profile.facts.age.value : null;

const clipperStart: Detector = {
  capability: "cost",
  topic: "clipper_start",
  covers: [],
  needs: ["monthly_income"],
  detect({ profile, data }) {
    if (data.state && data.state !== "CA") return null;
    const age = ageOf(profile);
    const c = CLIPPER_START;
    if (age !== null && (age < c.ages.from || age > c.ages.to)) return null;
    const income = profile.facts.monthly_income;
    if (typeof income.value !== "number" || income.value <= 0) return null;
    const size = Math.max(1, data.householdSize ?? 1);
    const limit = c.incomeLimitCents[Math.min(size, c.incomeLimitCents.length) - 1]!;
    const yearly = income.value * 12;
    if (yearly > limit) return null;
    const since = addDays(data.today, -90);
    const fares = data.transactions.filter(
      (t) =>
        t.amountCents > 0 && t.date >= since && t.date <= data.today && c.fareWords.test(lineOf(t)),
    );
    if (fares.length < c.minFares) return null;
    const spent = fares.reduce((n, t) => n + t.amountCents, 0);
    const first = fares.reduce((m, t) => (t.date < m ? t.date : m), data.today);
    const days = Math.max(30, daysBetween(first, data.today));
    const worth = Math.round(((spent * 365) / days) * c.discount);
    return suggestion("cost", "clipper_start", {
      title: "See if Clipper START halves your Bay Area transit fares",
      headline: headlineOf("Get half-price Bay Area transit fares", worth, "saves"),
      short: `${formatCents(spent)} on ${fares.length} transit fares since ${dayLabel(first)}; your income looks under the limit.`,
      worthCents: worth,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(income),
        evidence("seen", profile.months, fares.length, "transit fares"),
        // Its income is the household's on a tax return, which Jane doesn't have.
        { percent: 55, reason: "the limit is on your tax return's income, which I can't see" },
      ]),
      urgency: "later",
      why: `You paid ${formatCents(spent)} in ${fares.length} transit fares since ${dayLabel(first, { long: true })}, and about ${formatCents(yearly)} a year comes in. Clipper START takes ${Math.round(c.discount * 100)}% off single rides on BART, Caltrain, Muni, VTA, SamTrans and other Bay Area operators for someone aged ${c.ages.from} to ${c.ages.to} living in the nine Bay Area counties whose household income is ${formatWholeDollars(limit)} or less for ${size === 1 ? "one person" : `${size} people`} (2026). Clipper START counts a household as you, a spouse on a joint return and anyone on your return; if you're on a parent's return, its customer service can say which income counts. At your pace it would save about ${formatCents(worth)} a year. To apply: fill in the application on its site with a tax return or a CalFresh, Medi-Cal or Muni Lifeline card as proof, and the discount comes on a Clipper card with your name.`,
      action: { label: "Apply for Clipper START", href: c.applyUrl },
      more: [{ label: "Clipper START: who can get it", href: c.url }],
    });
  },
};

const aidPriorityDate: Detector = {
  capability: "safe_to_spend",
  topic: "aid_priority_date",
  covers: [],
  needs: ["is_student"],
  detect({ profile, data }) {
    const student = profile.facts.is_student;
    if (student.value !== true || !atStanford(data)) return null;
    // The priority date is for continuing undergraduates: a graduate student or a part-time one
    // who said so is not who it is for. Not said: the card says "if", and doesn't claim they are.
    const enrolled = profile.facts.enrollment.value;
    if (typeof enrolled === "string" && enrolled !== "undergrad") return null;
    const undergrad = enrolled === "undergrad";
    const left = daysBetween(data.today, AID_PRIORITY.date);
    if (left < 0 || left > AID_PRIORITY.aheadDays) return null;
    const since = addDays(data.today, -400);
    const aid = data.transactions.filter(
      (t) =>
        t.amountCents < 0 &&
        t.date >= since &&
        t.date <= data.today &&
        STANFORD_AID_WORDS.test(lineOf(t)),
    );
    if (aid.length === 0) return null;
    const got = aid.reduce((n, t) => n - t.amountCents, 0);
    const a = AID_PRIORITY;
    return suggestion("safe_to_spend", "aid_priority_date", {
      title: `File the FAFSA and CSS Profile for ${a.year} by Stanford's priority date, ${dayLabel(a.date, { long: true, year: true })}`,
      headline: "Get next year's aid forms in by Apr 30",
      short: `Stanford sent you ${formatCents(got)} in aid this year; next year's forms are due ${dayLabel(a.date)}.`,
      worthCents: 0,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(student),
        evidence("seen", profile.months, aid.length, "aid payments from Stanford"),
      ]),
      urgency: left <= 21 ? "now" : "soon",
      why: `Stanford sent you ${formatCents(got)} in ${aid.length} aid payment${aid.length === 1 ? "" : "s"} in the last year. ${undergrad ? "For continuing undergraduates" : "If you're a continuing undergraduate (I don't know how you're enrolled)"}, Stanford's priority filing date for ${a.year} aid is ${dayLabel(a.date, { long: true, year: true })}: the CSS Profile (school code ${a.cssCode}), the FAFSA (school code ${a.fafsaCode}) and your parents' tax documents. Done by then, the aid notice comes in August. Both forms opened October 1.`,
      action: { label: "See Stanford's aid requirements", href: a.url },
    });
  },
};

export const STUDENT_BENEFIT_DETECTORS: readonly Detector[] = [clipperStart, aidPriorityDate];
