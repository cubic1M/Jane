import type { DropReaction, RiskLevel } from "@/config/investing";
import type { PersonId } from "@/config/people";
import type { PracticePreferences } from "@/planning/practice-preferences";

// How each sample person runs their practice portfolio (Phase AW, Stage A), so the practice
// scan's ideas come up for them unasked as they would for a real person. The first scan starts
// the portfolio DEMO_PRACTICE_REPLAY_DAYS back (src/lib/practice/demo-start.ts), with `start`
// saved as their practice settings, then saves each change on its day while the days are
// replayed. The detector harness replays the same days on the sample market
// (src/profile/sample-practice.ts), so the two never disagree. Practice money only.
//
// `level` and `dropReaction` are what their investor profile's answers give (src/config/people.ts,
// seeded when the demo bank is linked): live reads the profile itself, and falls back to these
// only when it has none. A level set in `start` is their own choice in the practice settings.

export type DemoPracticeChange = { daysAgo: number; set: Partial<PracticePreferences> };
export type DemoPractice = {
  level: RiskLevel;
  dropReaction: DropReaction;
  start: Partial<PracticePreferences>;
  changes: readonly DemoPracticeChange[];
};

export const DEMO_PRACTICE: Readonly<Record<PersonId, DemoPractice>> = {
  // Maya tried Very high a few days ago, past the drop their answers said they could take, and moved
  // the practice money to the 28th: a risk mismatch, and the payday timing (paid on the 1st).
  renter: {
    level: 3,
    dropReaction: "worry",
    start: {},
    changes: [{ daysAgo: 5, set: { riskLevel: 5, addDay: 28 } }],
  },
  // The Reyes family picked Low and asks Jane before every trade: new money, a dip to buy, drift near
  // the band and a loss to harvest wait for them.
  family: {
    level: 3,
    dropReaction: "worry",
    start: { riskLevel: 2 },
    changes: [{ daysAgo: 30, set: { mode: "suggest" } }],
  },
  // Sam moved to suggest-only last week, so a news idea waits for a yes.
  freelancer: {
    level: 4,
    dropReaction: "fine",
    start: {},
    changes: [{ daysAgo: 7, set: { mode: "suggest" } }],
  },
  equity: { level: 4, dropReaction: "buy", start: {}, changes: [] },
  // Dan and Lena set their retirement date a few days ago: the glide path moves the mix.
  preretire: {
    level: 3,
    dropReaction: "worry",
    start: {},
    changes: [{ daysAgo: 4, set: { goalDate: "2031-06-01" } }],
  },
  // Ruth keeps it Very low and asks first, with the monthly money on the 8th: idle cash, a dip
  // and a loss to harvest.
  retiree: {
    level: 3,
    dropReaction: "worry",
    start: { riskLevel: 1 },
    changes: [{ daysAgo: 20, set: { mode: "suggest", addDay: 8 } }],
  },
  // Chris chose High for practice though they would sell in a fall: this autumn's dip brings them
  // close to the drop they said they could take.
  debt: { level: 1, dropReaction: "sell", start: { riskLevel: 4 }, changes: [] },
  // Jo never bought VXUS until a few days ago and now asks first: the cheaper twin of the
  // fund bought instead, and a news idea. No monthly practice money.
  owner: {
    level: 4,
    dropReaction: "fine",
    start: { avoid: ["VXUS"], monthlyAddCents: 0 },
    changes: [{ daysAgo: 4, set: { avoid: [], mode: "suggest" } }],
  },
};
