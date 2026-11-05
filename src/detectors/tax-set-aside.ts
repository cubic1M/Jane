import { formatWholeDollars } from "@/lib/money";
import { NOTHING_KEPT_APART } from "@/planning/tax-set-aside";
import { DETECTOR_RATES as R } from "@/config/detectors";
import { type Detector, type Suggestion, suggestionId } from "./contract";
import { urgencyForEstimated } from "./taxes";

// The tax on the income so far that isn't withheld or paid, brought up unasked: for freelancers,
// anyone with income and no withholding, or withholding that falls short. Not shown when nothing is
// left. The figure comes from src/lib/tax-set-aside.ts, the same one Safe to spend holds back.
//
// Two cards with one figure. A real account gets the arithmetic as a fact, and an estimate (founder's
// words were "how much should be set aside"; telling a real account that is tax advice, CLAUDE.md,
// src/lib/guardrails.ts). Demo advice gets "set aside", in an advice topic, so it carries the label.

const HREF = "/taxes?focus=estimate:set-aside";

function shared(figure: NonNullable<Figure>, today: string) {
  const worked = `Tax on your ${figure.year} income so far comes to about ${formatWholeDollars(figure.taxSoFarCents)}, and ${
    figure.withholdingKnown ? "" : "Jane assumes "
  }about ${formatWholeDollars(figure.paidSoFarCents)} ${figure.withholdingKnown ? "is" : "of it is"} withheld or paid.`;
  const kept = figure.keptApartCents > 0 ? "" : ` ${NOTHING_KEPT_APART}`;
  const unknowns = figure.unknowns.length > 0 ? ` ${figure.unknowns.join(" ")}` : "";
  return {
    worked,
    tail: `Safe to spend leaves it out.${kept}${unknowns}`,
    confidence: figure.confidence,
    urgency: urgencyForEstimated(today),
    worthCents: figure.holdCents,
    worthKind: "risk" as const,
    // It's owed whatever Jane says; knowing it avoids the surprise, so it counts for a share in ranking.
    rankCents: Math.round(figure.holdCents * R.tax.rankShareOfBill),
  };
}

type Figure = NonNullable<Parameters<Detector["detect"]>[0]["data"]["extras"]>["taxSetAside"];

const dueHere = (figure: Figure, advice: boolean): figure is NonNullable<Figure> =>
  figure !== undefined && figure.status === "needed" && figure.advice === advice;

// For real accounts: a fact, on their own numbers.
const taxNotYetPaid: Detector = {
  capability: "taxes",
  topic: "tax_not_yet_paid",
  covers: ["tax_estimate"],
  needs: [],
  detect({ profile, data }): Suggestion | null {
    const figure = data.extras?.taxSetAside;
    if (!dueHere(figure, false)) return null;
    const cents = formatWholeDollars(figure.holdCents);
    const { worked, tail, ...card } = shared(figure, profile.today);
    return {
      id: suggestionId("taxes", "tax_not_yet_paid"),
      capability: "taxes",
      topic: "tax_not_yet_paid",
      title: `About ${cents} of your ${figure.year} tax isn't withheld or paid yet (estimate)`,
      headline: `Check tax not yet paid: about ${cents}`,
      short: `An estimate from your ${figure.year} income so far. Safe to spend leaves it out.`,
      ...card,
      why: `${worked} That leaves about ${cents}, as an estimate, not tax advice. ${tail}`,
      action: { label: "See the calculation", href: HREF },
    };
  },
};

// For demo advice: the same figure as a move, labelled.
const taxSetAside: Detector = {
  capability: "taxes",
  topic: "tax_set_aside",
  covers: ["tax_estimate"],
  needs: [],
  detect({ profile, data }): Suggestion | null {
    const figure = data.extras?.taxSetAside;
    if (!dueHere(figure, true)) return null;
    const cents = formatWholeDollars(figure.holdCents);
    const { worked, tail, ...card } = shared(figure, profile.today);
    return {
      id: suggestionId("taxes", "tax_set_aside"),
      capability: "taxes",
      topic: "tax_set_aside",
      title: `Set aside about ${cents} for your ${figure.year} tax`,
      headline: `Set aside about ${cents} for tax`,
      short: `An estimate from your ${figure.year} income so far. Safe to spend leaves it out.`,
      ...card,
      why: `${worked} Setting aside about ${cents} covers the rest. ${tail}`,
      action: { label: "See the calculation", href: HREF },
    };
  },
};

export const TAX_SET_ASIDE_DETECTORS: readonly Detector[] = [taxNotYetPaid, taxSetAside];
