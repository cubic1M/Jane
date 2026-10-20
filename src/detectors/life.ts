import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, tx, weakest } from "./helpers";

// Detectors for life events and households (spec step 264). Pure; see ./contract.ts.

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
        why: `Your pay now comes from ${newJob[0]}, and your old paycheck stopped. A new job usually means enrolling in benefits, the 401(k) match, a new W-4 and an old 401(k) to move; the checklist is typically worth about ${formatCents(R.newJobTypicalCents)} in the first year.`,
        action: { label: "Open the checklist", href: "/life-events" },
      };
    }
    // A new child: the first childcare payment is recent.
    const care = tx(data, (x) => x.pfc === "GENERAL_SERVICES_CHILDCARE")
      .map((x) => x.date)
      .sort();
    if (care.length > 0 && care[0] >= since) {
      return {
        id: suggestionId("life_event", "life_checklist"),
        capability: "life_event",
        topic: "life_checklist",
        title: "Go through the new-baby checklist",
        worthCents: R.newChildTypicalCents,
        worthKind: "saves",
        confidence: weakest([
          factEvidence(profile.facts.has_children),
          evidence("guessed", profile.months, care.length, "childcare payments"),
        ]),
        urgency: "soon",
        why: `Childcare payments began on ${care[0]}. A new child usually means adding cover, claiming the credit and a care account; the checklist is typically worth about ${formatCents(R.newChildTypicalCents)} in the first year.`,
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

export const LIFE_DETECTORS: readonly Detector[] = [lifeChecklist, householdSetup];
