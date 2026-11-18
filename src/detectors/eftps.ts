import { EFTPS_INDIVIDUALS, IRS_DIRECT_PAY_URL } from "@/config/tax";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { type Detector, suggestion } from "./contract";
import { evidence, headlineOf, outCents, tx } from "./helpers";

// EFTPS no longer takes individuals' payments (connectors roadmap round 16; the IRS's page, checked
// 2026-11-17: src/config/tax.ts EFTPS_INDIVIDUALS): someone whose bank shows EFTPS tax payments is
// told where individuals pay now, and what's still possible in EFTPS. Facts and the IRS's own pages,
// no partner. Worth what those payments came to: what could go unpaid. Pure; see ./contract.ts.

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
    return suggestion("taxes", "eftps_move", {
      title: "EFTPS no longer takes individuals' tax payments: pay through your IRS Online Account",
      headline: headlineOf("Move tax payments off EFTPS", paid, "risk"),
      short: `EFTPS stopped taking individuals' payments; you've paid ${formatCents(paid)} through it.`,
      worthCents: paid,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, payments.length, "EFTPS payments"),
      urgency: "soon",
      why: `Your bank shows ${payments.length === 1 ? "a tax payment" : `${payments.length} tax payments`} through EFTPS, ${formatCents(paid)} in all. Since ${dayLabel(EFTPS_INDIVIDUALS.paymentsEnded, { long: true, year: true })}, the IRS says EFTPS no longer takes individuals' payments (it stopped taking new individual accounts on ${dayLabel(EFTPS_INDIVIDUALS.enrollmentClosed, { long: true, year: true })}). Individuals pay most taxes through their IRS Online Account, and IRS Direct Pay takes the less common payment types. A payment you scheduled in EFTPS before can still be cancelled there up to ${EFTPS_INDIVIDUALS.cancelBusinessDays} business days before its date. If these are a business's payments, EFTPS is still there for businesses.`,
      action: { label: "See your tax calendar", href: "/taxes" },
      more: [
        { label: "Your IRS Online Account", href: EFTPS_INDIVIDUALS.onlineAccountUrl },
        { label: "IRS Direct Pay", href: IRS_DIRECT_PAY_URL },
      ],
    });
  },
};

export const EFTPS_DETECTORS: readonly Detector[] = [eftpsMove];
