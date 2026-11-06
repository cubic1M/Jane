import { EFTPS_INDIVIDUALS } from "@/config/tax";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, headlineOf, outCents, tx } from "./helpers";

// EFTPS is closing to individuals (connectors roadmap round 16): someone whose bank shows EFTPS
// tax payments is told to move them to the IRS Online Account before EFTPS stops taking them.
// Facts and a link, no partner. Worth what those payments came to: what could go unpaid. Pure; see
// ./contract.ts.

const eftpsMove: Detector = {
  capability: "taxes",
  topic: "eftps_move",
  covers: ["tax_calendar"],
  needs: [],
  detect({ profile, data }) {
    const payments = tx(
      data,
      (t) =>
        t.amountCents > 0 &&
        EFTPS_INDIVIDUALS.match.test(`${t.description} ${t.merchantName ?? ""}`),
    );
    if (payments.length === 0) return null;
    const paid = outCents(payments);
    return {
      id: suggestionId("taxes", "eftps_move"),
      capability: "taxes",
      topic: "eftps_move",
      title: "Move your EFTPS tax payments to your IRS Online Account",
      headline: headlineOf("Move tax payments off EFTPS", paid, "risk"),
      short: `EFTPS is closing to individuals; you've paid ${formatCents(paid)} through it.`,
      worthCents: paid,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, payments.length, "EFTPS payments"),
      urgency: "soon",
      why: `Your bank shows ${payments.length === 1 ? "a tax payment" : `${payments.length} tax payments`} through EFTPS, ${formatCents(paid)} in all. EFTPS stopped taking new individual accounts on October 17, 2025, and individuals are to move off it ${EFTPS_INDIVIDUALS.moveBy}. The IRS Online Account schedules the same payments, up to 365 days ahead. If these are a business's payments, EFTPS stays open for those.`,
      action: { label: "See your tax calendar", href: "/taxes" },
      more: [{ label: "Your IRS Online Account", href: EFTPS_INDIVIDUALS.onlineAccountUrl }],
    };
  },
};

export const EFTPS_DETECTORS: readonly Detector[] = [eftpsMove];
