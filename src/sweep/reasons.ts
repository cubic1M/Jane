import { STALE_UPLOAD_DAYS } from "@/config/import";
import { DATA_ENDED_AFTER_DAYS } from "@/config/insights";
import { RESELECT_AFTER_DAYS } from "@/config/suggestions";
import { FILING, FORMS_COMING, W4 } from "@/config/student-taxes";
import { addDays } from "@/detection/units";
import { STALE_AFTER_DAYS } from "@/profile/build";
import { DETECTOR_RATES } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import type { Flat, Reason } from "./diff";

// The reasons a figure or finding may change from one day to the next while a person's data is
// held fixed and is past STALE_AFTER_DAYS (gate C, mvp-ready.md). Each names what moves and why.
// Anything else that moves is a bug. A reason added here is a claim that the change is right:
// keep each one as narrow as the change it explains.

const firstOfMonth = (day: string) => day.endsWith("-01");

// Jan 1's income adds up from Dec 31's, to the cent, with nothing else moving: last year's figure is
// exactly what yesterday said this year's was (the cards that are for 2026, the Saver's Credit, still
// read it), the new year has no pay in it yet so its figure is the same month as a year with no
// bonus in it, and the chat says that figure. The month itself hasn't moved.
export function taxYearTurned(before: Flat, after: Flat): boolean {
  const month = after["income.monthlyCents"];
  const year = after["income.yearCents"];
  return (
    typeof month === "number" &&
    month === before["income.monthlyCents"] &&
    typeof before["income.yearCents"] === "number" &&
    after["income.lastYearCents"] === before["income.yearCents"] &&
    after["income.fromMonthCents"] === Math.round(month * 12 * DETECTOR_RATES.tax.netToGross) &&
    year === after["income.fromMonthCents"] &&
    after["income.payOnly"] !== true &&
    after["income.chatYearGross"] === (year > 0 ? formatCents(year) : null)
  );
}
const newYear = (day: string) => day.endsWith("-01-01");
const december = (day: string) => day.slice(5, 7) === "12";
// A path as a pattern that matches only itself: every character a pattern reads is escaped, the
// backslash included (code scanning, js/incomplete-sanitization: only dots were).
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The one day `days` after one of the person's own dates, or after any account's newest line.
type Dates = { linked: string; lastLine: string; accountsLast?: string[] };
const daysAfter = (from: "linked" | "lastLine", days: number) => (day: string, p: Dates) =>
  Boolean(p[from]) && day === addDays(p[from], days);
const daysAfterAnAccount = (days: number) => (day: string, p: Dates) =>
  (p.accountsLast ?? []).some((last) => day === addDays(last, days));

export const DATED: readonly Reason[] = [
  // The person's day itself.
  { name: "today's date", paths: /(^asOf$|\.asOf$|\.today$)/ },
  // What's ahead: bills, paydays, deadlines and the money before payday. Each counts down, drops
  // off when its day passes and a new one comes within reach; and checking today, a statement's
  // balance walked forward past them (the chat's cash answer).
  {
    name: "what's coming up",
    paths:
      /^(home\.summary\.(comingUp|deadlines|cashFlow|safeToSpend)|home\.(cashFlow|hero\.safe)\.|trees\.ahead\.|trees\.money\.(chips\.|summaries\.coming:|tree\.branches\.coming\.)|chat\.(what bills are coming up|when do I get paid|how much is my paycheck|what's safe to spend|how much cash do I have)\.|cash\.places\.|decides\.)/,
  },
  // The net worth chart: a point for every day, ending today.
  { name: "a day on the chart", paths: /^(netWorth\.|home\.hero\.netWorth\.)/ },
  // A yearly bill's set-aside: so much more by now each day, and the monthly amount steps when
  // one comes due.
  {
    name: "set aside for yearly bills",
    paths:
      /^trees\.(money|ahead)\.(summaries\.(yearly:|money:yearly)|tree\.branches\.[^.]+\.items\.[^.]+\.figure)/,
  },
  // A new month: this month's spending starts again, last month closes, the payoff month and the
  // monthly plans count from it.
  {
    name: "a new month",
    paths:
      /^(tiles\.[^.]+\.(caption|value|chart)|trees\.(money|loans)\.|chat\.how much did I spend this month\.|suggestions\.(close:month_close|spending:budget_overrun|debt:consolidation|safe_to_spend:emergency_fund)\.|detected\.idle_cash:|suggestions\.investing:idle_cash\.)/,
    on: firstOfMonth,
  },
  // A new year: this year's taxes, contributions and moves start again.
  {
    name: "a new year",
    paths: /^(trees\.(taxes|insurance)\.|suggestions\.(taxes:|investing:employer_match)|tiles\.)/,
    on: newYear,
  },
  // The tax year turning: on Jan 1 this year's income is the new year's, and it adds up (gate C's
  // calendar sweep, 1-1, ten frozen runs: the renter's 5,261,568 to 5,116,800 cents, mid-start's
  // payOnly). See taxYearTurned.
  {
    name: "the tax year turning",
    paths: /^income\.(yearCents|lastYearCents|fromMonthCents|payOnly|chatYearGross)$/,
    on: newYear,
    holds: taxYearTurned,
  },
  // The tax calendar's December: year-end moves become urgent and "by Dec 31" comes up.
  {
    name: "the year's last weeks",
    paths: /^(trees\.taxes\.|suggestions\.taxes:year_end_moves\.)/,
    on: december,
  },
  // A wash sale leaves the Taxes count 61 days after it.
  {
    name: "a wash sale's window ending",
    paths: /^trees\.taxes\.tree\.branches\.[^.]+\.items\.[^.]+\.(figure|status)$/,
  },
  // A charge that stopped: a subscription, bill or trial past ACTIVE_WITHIN_INTERVALS of its usual
  // gap (detection/streams.ts), a duplicate past its window, and what's built on them.
  {
    name: "a charge that stopped",
    paths:
      /^(detected\.(subscription_review|bill_negotiation|trial_conversion|duplicate_charge|duplicate_subscription|covered_by_card|insurance_reshop|price_increase):|chat\.what subscriptions do I pay for\.|suggestions\.(subscriptions:subscriptions|cost:duplicate_charge)\.|trees\.money\.(summaries\.subscriptions:|tree\.branches\.(subscriptions|charges)\.|tree\.branches\.length$))/,
  },
  // A tax date nearing: "due in 45 days", and how soon a tax suggestion needs doing as its date
  // comes (estimated tax on Jan 15, the return on Apr 15, an S-corp election by Mar 15).
  {
    name: "a tax date nearing",
    paths: /^suggestions\.taxes:([^.]+\.urgency|(file_return|estimated_taxes)\.(short|why))$/,
  },
  // A promo price's end or a yearly renewal passing its date (price_rises:promo_ending names it).
  { name: "a promo price ending", paths: /^suggestions\.price_rises:promo_ending\./ },
  // A dealer add-on's refund is the unused part: a little less each month of cover used.
  {
    name: "a month of cover used",
    paths: /^suggestions\.debt:car_addons\.(headline|short|why|worthCents)$/,
  },
  // Goals: each month nearer its date needs more a month, and this month's plan sets the room.
  {
    name: "a goal's date nearing",
    paths: /^suggestions\.tradeoffs:goal_tradeoffs\.(headline|short|why|worthCents)$/,
  },
  // The practice account (src/lib/paper/): simulated money at each day's real prices.
  { name: "a day's prices", paths: /^tiles\.investments\.(value|caption|chart\.)/ },
  // A policy's renewal coming within RENEWAL_SOON_DAYS or passing (config/insurance.ts).
  {
    name: "a policy renewing",
    paths: /^(trees\.insurance\.|tiles\.insurance\.(health|healthWhy))/,
  },
  // A payday loan taken again "and again" only while the newest is inside COSTLY_CYCLE_DAYS.
  { name: "costly borrowing's cycle", paths: /^suggestions\.debt:high_cost_loans\.why$/ },
  // The stand-in lenders' rates move a little each month, like real ones (src/lib/lenders/demo.ts).
  {
    name: "this month's lender quotes",
    paths: /^suggestions\.debt:borrowing_power\.(headline|short|why|worthCents)$/,
    on: firstOfMonth,
  },
  // The data has ended (src/lib/data-ended.ts): DATA_ENDED_AFTER_DAYS past the newest line, the
  // chat says what it has ends there instead of answering from its last month.
  {
    name: "the data ending",
    // And Money's month line says to when, as the chat does: "in October (to Oct 22, where what I
    // have ends)" (gate C, debug 3, 11-19: the upload people's 15th day).
    paths: /^(chat\.how much did I spend this month\.|trees\.money\.summaries\.spending:month$)/,
    on: daysAfter("lastLine", DATA_ENDED_AFTER_DAYS + 1),
  },
  // Statements that end more than STALE_UPLOAD_DAYS ago say nothing about now (statementsTooOld,
  // staleStatementsEnd): the cushion, idle-cash and cheaper-plan cards ("You keep $X in cash",
  // "you pay $17.99") wait for newer ones, and Money's and the chat's net worth say when it's
  // from (gate C, debug 3, 11-19: the frozen demo data's 46th day).
  {
    name: "statements too old to say what's now",
    paths:
      /^(suggestions\.(safe_to_spend:emergency_fund|investing:idle_cash|subscriptions:cheaper_tier)\.|chat\.what's my net worth\.body$|trees\.money\.summaries\.have:net-worth$)/,
    on: daysAfter("lastLine", STALE_UPLOAD_DAYS + 1),
  },
  // The return's due date counted down: "due April 15, 2027, 37 days from now". The card is the
  // filing season's own: it comes on W4.extensionFrom and goes the day after the return is due.
  { name: "the return's countdown", paths: /^suggestions\.taxes:filing_extension\.why$/ },
  {
    name: "the filing season",
    paths: /^suggestions\.taxes:filing_extension\./,
    on: (day) =>
      day.slice(5) === W4.extensionFrom || day.slice(5) === addDays(FILING.due, 1).slice(5),
  },
  // The forms on the way for the year (src/detectors/tax-forms.ts) come on FORMS_COMING.from and go
  // the day after FORMS_COMING.until (gate C, debug 3, 11-19: every person's Dec 1).
  {
    name: "the tax forms season",
    paths: /^suggestions\.taxes:tax_forms_coming\./,
    on: (day) =>
      day.slice(5) === FORMS_COMING.from ||
      day.slice(5) === addDays(`2001-${FORMS_COMING.until}`, 1).slice(5),
  },
  // A balance older than STALE_AFTER_DAYS isn't today's: safe to spend is left out (an upload's,
  // whose balance is its statement's). Each account's own: an old checking file beside a recent
  // card's (debug 3, 11-16).
  {
    name: "a balance too old to use",
    paths: /^(home\.hero\.safe$|chat\.what's safe to spend\.)/,
    on: daysAfterAnAccount(STALE_AFTER_DAYS + 1),
  },
  // The scan's picks last RESELECT_AFTER_DAYS (src/lib/suggestions.ts offeredToday). Only linked
  // banks are scanned nightly, so an upload's lapse and the chat ranks the rest instead.
  {
    name: "the scan's picks lapsing",
    paths: /^chat\.what should I do first\./,
    on: daysAfter("linked", RESELECT_AFTER_DAYS),
  },
  // A tree's count of what's urgent and what to look at moves with its items.
  {
    name: "a tree's items",
    paths: /^trees\.[^.]+\.tree\.sub$/,
    follows: (path) => new RegExp(`^${literal(path.replace(/\.sub$/, ""))}\\.branches\\.`),
  },
  // Home's tile says its area page's status and line (src/lib/hub/area-status.ts), so it moves
  // with that tree's branches.
  {
    name: "an area tile's tree",
    paths: /^tiles\.[^.]+\.(?:health|healthWhy)$/,
    follows: (path) => new RegExp(`^trees\\.${literal(path.split(".")[1]!)}\\.tree\\.branches\\.`),
  },
];
