import { US_STATES } from "@/config/referrals";
import { SOURCES } from "@/config/student-taxes";
import { STATE_TAX } from "@/config/tax-rates";
import { monthLabel } from "@/lib/day-label";
import { stateMove } from "@/profile/home-state";
import { type Detector, type Suggestion, suggestion } from "./contract";
import { evidence, weakest } from "./helpers";

// A move into or out of California during the year (suggest-taxes gap pass): a student who arrives in
// September is a part-year resident, and California's return for that year is Form 540NR, taxing all
// income while a resident and only California-source income while not. Read from where card purchases
// happen month by month (src/profile/home-state.ts stateMove). A fact; pure.

const nameOf = (code: string) => US_STATES.find((s) => s.code === code)?.name ?? code;

const californiaMove: Detector = {
  capability: "taxes",
  topic: "state_move",
  covers: ["tax_calendar"],
  needs: [],
  detect({ profile, data }): Suggestion | null {
    const year = profile.today.slice(0, 4);
    const rows = data.transactions.filter((t) => t.date.startsWith(`${year}-`));
    const move = stateMove(rows);
    if (!move || (move.from !== "CA" && move.to !== "CA")) return null;
    const into = move.to === "CA";
    const other = into ? move.from : move.to;
    const noTax =
      STATE_TAX[other]?.kind === "none" ? ` ${nameOf(other)} has no income tax on wages.` : "";
    const month = monthLabel(move.month, { long: true, year: true });
    return suggestion("taxes", "state_move", {
      title: `Your purchases moved ${into ? "to" : "from"} California by ${month}: if you moved, a part-year year for its income tax`,
      headline: "Note California's part-year rules",
      short: `Your purchases move from ${nameOf(move.from)} to ${nameOf(move.to)} by ${month}.`,
      worthCents: 0,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, rows.length, "located purchases"),
        // Where cards are used can't say whether the home changed, or a stay was temporary.
        {
          percent: 60,
          reason: "purchases can't show whether you changed your home or stayed a while",
        },
      ]),
      urgency: "later",
      why: `Your card purchases are mostly in ${nameOf(move.from)} until ${month} and in ${nameOf(move.to)} from then on. If you moved your home, California taxes a part-year resident on all income while a resident and only on California-source income while not (FTB's Schedule CA (540NR) instructions, linked).${noTax}`,
      action: { label: "See your taxes", href: "/taxes" },
      more: [
        { label: "FTB: part-year residents (Schedule CA (540NR))", href: SOURCES.ftb540nrCa.url },
      ],
    });
  },
};

export const STATE_MOVE_DETECTORS: readonly Detector[] = [californiaMove];
