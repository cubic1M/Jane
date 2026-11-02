import { DETECTOR_RATES as R } from "@/config/detectors";
import { EARNER_ACTIVE_DAYS, SALARY_DEPOSITS_MIN } from "@/config/profile";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, headlineOf, tx, weakest } from "./helpers";

// Detectors for life events and households (spec step 264). Pure; see ./contract.ts.

// "MERIDIAN MEDICAL" as people say it: "Meridian Medical".
const nice = (name: string) => name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const lifeChecklist: Detector = {
  covers: ["life_events"],
  capability: "life_event",
  topic: "life_checklist",
  needs: [],
  detect({ profile, data }) {
    const since = addDays(data.today, -R.lifeLookbackDays);
    // A new job: a payroll whose first deposit is recent, while another payroll has stopped.
    const first = new Map<string, string>();
    const last = new Map<string, string>();
    for (const t of tx(data, (x) => x.amountCents < 0 && x.pfc === "INCOME_SALARY")) {
      const name = t.description.replace(/\s+PAYROLL.*$/i, "").trim();
      if (!first.has(name) || t.date < first.get(name)!) first.set(name, t.date);
      if (!last.has(name) || t.date > last.get(name)!) last.set(name, t.date);
    }
    const newJob = [...first.entries()].find(
      ([name, day]) =>
        day >= since && [...last.entries()].some(([other, end]) => other !== name && end < day),
    );
    if (newJob) {
      const deposits = tx(
        data,
        (x) => x.description.startsWith(newJob[0]) && x.pfc === "INCOME_SALARY",
      ).length;
      return {
        id: suggestionId("life_event", "life_checklist"),
        capability: "life_event",
        topic: "life_checklist",
        title: "Go through the new-job checklist",
        headline: headlineOf("Open the new-job checklist", R.newJobTypicalCents, "saves", true),
        short: `Your pay now comes from ${nice(newJob[0])}; a checklist is worth about ${formatCents(R.newJobTypicalCents)}.`,
        worthCents: R.newJobTypicalCents,
        worthKind: "saves",
        // A guess from the pay: a new employer appeared as another stopped.
        confidence: evidence(
          "guessed",
          profile.months,
          deposits,
          "paychecks from the new employer",
        ),
        urgency: "soon",
        why: `Your pay now comes from ${nice(newJob[0])}, and your old paycheck stopped. A new job usually means enrolling in benefits, the 401(k) match, a new W-4 and an old 401(k) to move; the checklist is typically worth about ${formatCents(R.newJobTypicalCents)} in the first year.`,
        action: { label: "Open the checklist", href: "/life-events" },
      };
    }
    // A new child: the first childcare payment is recent, and well after the data begins.
    const care = tx(data, (x) => x.pfc === "GENERAL_SERVICES_CHILDCARE")
      .map((x) => x.date)
      .sort();
    const dataFrom = data.transactions.reduce(
      (min, t) => (t.date < min ? t.date : min),
      data.today,
    );
    if (
      care.length > 0 &&
      care[0] >= since &&
      care[0] >= addDays(dataFrom, R.lifeNewAfterDataDays)
    ) {
      const began = dayLabel(care[0], { year: true });
      return {
        id: suggestionId("life_event", "life_checklist"),
        capability: "life_event",
        topic: "life_checklist",
        title: "Go through the new-baby checklist",
        headline: headlineOf("Open the new-baby checklist", R.newChildTypicalCents, "saves", true),
        short: `Childcare payments began on ${began}.`,
        worthCents: R.newChildTypicalCents,
        worthKind: "saves",
        confidence: weakest([
          factEvidence(profile.facts.has_children),
          evidence("guessed", profile.months, care.length, "childcare payments"),
        ]),
        urgency: "soon",
        why: `Childcare payments began on ${began}. A new child usually means adding cover, claiming the credit and a care account; the checklist is typically worth about ${formatCents(R.newChildTypicalCents)} in the first year.`,
        action: { label: "Open the checklist", href: "/life-events" },
      };
    }
    return null;
  },
};

const householdSetup: Detector = {
  covers: [],
  capability: "life_event",
  topic: "household_setup",
  needs: ["household"],
  detect({ profile, data }) {
    const household = profile.facts.household;
    if (household.value !== "couple" && household.value !== "family") return null;
    if (!data.extras || data.extras.householdMembers > 0) return null;
    return {
      id: suggestionId("life_event", "household_setup"),
      capability: "life_event",
      topic: "household_setup",
      title: "Invite your partner so you plan the household together",
      headline: headlineOf("Set up your household", R.householdTypicalCents, "saves"),
      short: `Your pay looks like a household, worth about ${formatCents(R.householdTypicalCents)} a year in doubled-up bills.`,
      worthCents: R.householdTypicalCents,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(household),
        evidence("seen", profile.months, 1, "household check"),
      ]),
      urgency: "later",
      why: `Your pay and spending look like a household of more than one, and nobody else is in yours on Jane. Sharing only the accounts you choose lets you see shared goals and bills once, typically worth about ${formatCents(R.householdTypicalCents)} a year in doubled-up bills.`,
      action: { label: "Set up your household", href: "/household" },
    };
  },
};

// A paycheck that stopped, with no new one. The late-paycheck change only looks at the last few days,
// so someone uploading months later heard nothing (debugger 11-02). It says what it can see and not
// why: they may have left, retired or moved their pay to another bank.
const payStopped: Detector = {
  covers: [],
  capability: "life_event",
  topic: "pay_stopped",
  needs: [],
  detect({ profile, data }) {
    const last = new Map<string, string>();
    const paid = new Map<string, number>();
    const pay = tx(data, (x) => x.amountCents < 0 && x.pfc === "INCOME_SALARY");
    for (const t of pay) {
      const name = t.description.replace(/\s+PAYROLL.*$/i, "").trim();
      if ((last.get(name) ?? "") < t.date) last.set(name, t.date);
      paid.set(name, (paid.get(name) ?? 0) + 1);
    }
    if (last.size === 0) return null;
    const dataEnds = data.transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
    const stillPaidSince = addDays(dataEnds, -EARNER_ACTIVE_DAYS);
    const [name, lastDay] = [...last].sort((a, b) => b[1].localeCompare(a[1]))[0];
    if (lastDay > stillPaidSince || (paid.get(name) ?? 0) < SALARY_DEPOSITS_MIN) return null;
    const now =
      typeof profile.facts.monthly_income.value === "number"
        ? profile.facts.monthly_income.value
        : 0;
    const paychecks = pay.filter((t) => t.description.startsWith(name));
    const total = paychecks.reduce((s, t) => s - t.amountCents, 0);
    const firstDay = paychecks.reduce((m, t) => (t.date < m ? t.date : m), lastDay);
    const months = Math.max(1, daysBetween(firstDay, lastDay) / 30);
    // The first to the last paycheck spans one gap fewer than there are paychecks.
    const before = Math.round((total * (paychecks.length - 1)) / paychecks.length / months);
    const less = Math.max(0, before - now);
    return {
      id: suggestionId("life_event", "pay_stopped"),
      capability: "life_event",
      topic: "pay_stopped",
      title: `I don't see a paycheck from ${nice(name)} since ${dayLabel(lastDay)}`,
      headline: headlineOf("Your pay looks like it stopped", less, "risk"),
      short: `About ${formatCents(now)} a month is coming in now, about ${formatCents(less)} less.`,
      worthCents: less,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, paid.get(name) ?? 0, "paychecks"),
      urgency: "now",
      // A month's shortfall against a year's savings tip: as a year, so it comes first.
      rankCents: less * 12,
      why: `I don't see a paycheck from ${nice(name)} since ${dayLabel(lastDay)}, and about ${formatCents(now)} a month is coming in now. Your bills are all on Coming up, so you can see what can wait. If your pay moved to another bank, add that account and this goes away.`,
      action: { label: "See what's coming up", href: "/bills" },
    };
  },
};

export const LIFE_DETECTORS: readonly Detector[] = [lifeChecklist, householdSetup, payStopped];
