import {
  DAILY_REPORT_MAX_HEADS_UP,
  DAILY_REPORT_MAX_SUGGESTIONS,
  DAILY_REPORT_USUAL_DAYS,
} from "@/config/daily-report";
import { addDays } from "@/detection/units";
import { dayLabel } from "@/lib/day-label";
import { dollarFigures, splitByGuardrails } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";
import { tellsThemToAct } from "@/lib/real-account-text";
import type { PostedSince, SpendingDay } from "./spending-day";

// What goes in one day's report, as sentences each of which may open a page. Pure: the facts the
// loader read in, the report out. A report is always built (a quiet day says so; the person asked
// for one every day). Every sentence passes src/lib/guardrails.ts: a sentence that fails is left
// out. What it says is what the accounts show and what Jane sees, never what to do.

export type DailySuggestion = {
  headline: string;
  short: string;
  percent: number;
  worthCents: number;
  // A page of the app, e.g. "/subscriptions".
  path: string;
};

export type DailyReportInput = {
  // The person's own today (YYYY-MM-DD).
  today: string;
  spending: SpendingDay;
  // Lines the bank posted since the last report with an earlier date (it posts a day or two late).
  // Each line is in exactly one report: the ones that arrived after the last report's run.
  postedSince?: PostedSince;
  // The last day the statements reach (src/lib/data-reach.ts), null when there are no transactions.
  reach: string | null;
  // The day a linked bank last updated, null for uploads only.
  bankUpdated: string | null;
  // Open suggestions first seen since the last report, the best first, and how many there were.
  suggestions: DailySuggestion[];
  suggestionsTotal: number;
  // Alerts raised and changes noticed since the last report, with how sure Jane is.
  headsUp: { title: string; percent: number | null }[];
  // Bills, expected pay and deadlines in the next few days, soonest first.
  ahead: { label: string; date: string; amountCents: number | null; daysLeft: number }[];
};

export type ReportItem = { text: string; path?: string };
export type ReportSection = { heading: string; items: ReportItem[] };
export type DailyReport = {
  subject: string;
  title: string;
  sections: ReportSection[];
  // Something besides yesterday's line to say. False on a quiet day.
  busy: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A sentence that starts with a move a real account is never told to make (CLAUDE.md: switch, cancel,
// move, file, elect; the act-gating test names the same ones). tellsThemToAct reads money topics only.
const MOVE_AT_START =
  /^(?:switch|cancel|move|file|elect|refinance|roll over|rollover|sell|buy|transfer|open (?:a|an) (?:\w+ ){0,3}(?:account|ira|401\(?k\)?|card|loan|hsa|529))\b/i;
const tellsToAct = (text: string) =>
  tellsThemToAct(text) ||
  text.split(/(?<=[.!?:;])\s+|\n+/).some((sentence) => MOVE_AT_START.test(sentence.trim()));

// The sentence if it states a fact: it passes the guardrails (with only the dollar figures in
// `figures`) and doesn't tell the person to act. Otherwise null, and it is left out.
function checked(text: string, figures: readonly number[]): string | null {
  if (tellsToAct(text)) return null;
  const { kept, dropped } = splitByGuardrails(text, figures);
  return dropped.length === 0 ? kept.join(" ") : null;
}

// Detector-written text (a suggestion's headline) carries its own figures, which its detector
// supports: the other checks (advice, promises, links, claimed acts) still apply to it.
const ownFigures = (text: string, extra: readonly number[]) => [
  ...dollarFigures(text).map((f) => f.cents),
  ...extra,
];

// A change's title ends with a full stop; the "(84% sure)" after it ends the line instead.
const noStop = (title: string) => title.replace(/\.$/, "");
const sure = (percent: number | null) => (percent === null ? "" : ` (${percent}% sure)`);

const when = (daysLeft: number) =>
  daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;

const kept = (texts: string[], figures: readonly number[]): ReportItem[] =>
  texts.flatMap((text) => {
    const ok = checked(text, figures);
    return ok === null ? [] : [{ text: ok }];
  });

function yesterdaySection(input: DailyReportInput): ReportSection | null {
  const { spending: s, reach, today } = input;
  const yesterday = addDays(today, -1);
  // Statements that stop before yesterday can't say what was spent: said below, never as $0.
  if (reach === null || reach < yesterday) return null;
  const texts: string[] = [];
  if (s.purchases > 0) {
    texts.push(
      `Your accounts showed ${plural(s.purchases, "purchase", "purchases")} totaling ${formatCents(s.totalCents)}.`,
    );
  } else if (s.totalCents < 0) {
    texts.push(`Your accounts showed ${formatCents(-s.totalCents)} back in refunds.`);
  } else {
    texts.push("Your accounts showed no spending.");
  }
  if (s.largest.length > 0) {
    texts.push(
      `Largest: ${s.largest.map((l) => `${l.merchant} ${formatCents(l.cents)}`).join(", ")}.`,
    );
  }
  if (s.unusual && s.usualCents !== null) {
    texts.push(
      `That is well above a usual day: about ${formatCents(s.usualCents)}, the middle of your last ${DAILY_REPORT_USUAL_DAYS / 7} weeks of days with spending.`,
    );
  }
  if (s.pending > 0) {
    texts.push(
      `${plural(s.pending, "more charge is", "more charges are")} still pending, and not counted above.`,
    );
  }
  const figures = [
    s.totalCents,
    Math.abs(s.totalCents),
    s.usualCents ?? 0,
    ...s.largest.map((l) => l.cents),
  ];
  return { heading: `Yesterday, ${dayLabel(yesterday)}`, items: kept(texts, figures) };
}

function dataSection(input: DailyReportInput): ReportSection | null {
  const { reach, today, bankUpdated } = input;
  if (reach !== null && reach >= addDays(today, -1)) return null;
  const texts = [
    reach === null
      ? "Jane has no transactions for you yet."
      : `Your data ends ${dayLabel(reach)}, so yesterday is not in it yet.`,
    ...(bankUpdated ? [`Your bank last updated ${dayLabel(bankUpdated)}.`] : []),
  ];
  return { heading: "Where your data ends", items: kept(texts, []) };
}

// The bank posts a charge a day or two after its date: what arrived since the last report with an
// earlier date, so it isn't missed (and, being only what arrived after that report, is never said twice).
function postedSection(input: DailyReportInput): ReportSection | null {
  const p = input.postedSince;
  if (!p || (p.count === 0 && p.totalCents === 0)) return null;
  const what =
    p.count > 0
      ? `${plural(p.count, "charge", "charges")} totaling ${formatCents(p.totalCents)}`
      : `${formatCents(-p.totalCents)} back in refunds`;
  const names =
    p.largest.length > 0
      ? ` (${p.largest.map((l) => `${l.merchant} ${formatCents(l.cents)}`).join(", ")})`
      : "";
  const figures = [p.totalCents, Math.abs(p.totalCents), ...p.largest.map((l) => l.cents)];
  return {
    heading: "Posted since your last report",
    items: kept([`Your bank posted ${what} with earlier dates${names}.`], figures),
  };
}

function suggestionsSection(input: DailyReportInput): ReportSection | null {
  // Checked first, then the best few kept: a sentence left out doesn't use up a place.
  const passing: ReportItem[] = input.suggestions.flatMap((s) => {
    const text = `${s.headline || s.short}${sure(s.percent)}`;
    const ok = checked(text, ownFigures(text, [s.worthCents]));
    return ok === null ? [] : [{ text: ok, path: s.path }];
  });
  const items = passing.slice(0, DAILY_REPORT_MAX_SUGGESTIONS);
  const more = input.suggestionsTotal - items.length;
  if (items.length > 0 && more > 0) {
    items.push({ text: `And ${more} more on your home page.`, path: "/home" });
  }
  return { heading: "New from Jane", items };
}

function headsUpSection(input: DailyReportInput): ReportSection | null {
  const items: ReportItem[] = input.headsUp.slice(0, DAILY_REPORT_MAX_HEADS_UP).flatMap((h) => {
    const text = `${noStop(h.title)}${sure(h.percent)}`;
    const ok = checked(text, ownFigures(text, []));
    return ok === null ? [] : [{ text: ok, path: "/jane" }];
  });
  return { heading: "What changed", items };
}

function aheadSection(input: DailyReportInput): ReportSection | null {
  const items: ReportItem[] = input.ahead.flatMap((a) => {
    const amount = a.amountCents === null ? "" : ` ${formatCents(a.amountCents)},`;
    const text = `${a.label}:${amount} ${dayLabel(a.date)} (${when(a.daysLeft)}).`;
    const ok = checked(text, a.amountCents === null ? [] : [a.amountCents]);
    return ok === null ? [] : [{ text: ok }];
  });
  return { heading: "Coming up", items };
}

export function buildDailyReport(input: DailyReportInput): DailyReport {
  const news = [
    postedSection(input),
    suggestionsSection(input),
    headsUpSection(input),
    aheadSection(input),
    dataSection(input),
  ].filter((s): s is ReportSection => s !== null && s.items.length > 0);
  const yesterday = yesterdaySection(input);
  const sections = [...(yesterday && yesterday.items.length > 0 ? [yesterday] : []), ...news];
  const busy = news.length > 0 || input.spending.unusual;
  if (!busy) {
    sections.push({ heading: "Today", items: [{ text: "Nothing new from Jane today." }] });
  }
  const label = dayLabel(input.today);
  return {
    // A subject shows on a lock screen: no amounts and no names in it.
    subject: `Jane: your daily report, ${label}`,
    title: `Your daily report, ${label}`,
    sections,
    busy,
  };
}
