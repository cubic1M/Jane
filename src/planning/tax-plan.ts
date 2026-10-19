import {
  PLAN_ORDER,
  TAX_PLAN,
  W4_AFTER_EVENT_DAYS,
  W4_LIFE_EVENTS,
  type PlanDate,
  type PlanMoveKey,
} from "@/config/tax-plan";
import type { SavingKey } from "@/planning/tax-savings";

// The year-round tax plan (spec step 167). Pure. From what Jane knows about the tax year
// (ways to pay less from step 122, estimated payments from step 123, a loss worth
// harvesting from step 124, gifts tagged, life events, whether the return's filed), the
// tax moves that apply, each with its deadline from src/config/tax-plan.ts and the reminder
// Jane prepares for it. Nothing past its deadline is offered.

export type PlanFacts = {
  year: number;
  today: string;
  // Demo advice mode: recommendations (contributions, sales, gifts) are included.
  advice: boolean;
  savings: { key: SavingKey; title: string; estimateCents: number }[];
  // Federal estimated payments still to make, by due date.
  estimated: { date: string; cents: number }[];
  harvest: { name: string; lossCents: number } | null;
  donationsCents: number;
  lifeEvents: { kind: string; startedOn: string }[];
  filed: boolean;
};

export type PlanMove = {
  // "<year>:<key>", stable for the year.
  id: string;
  key: PlanMoveKey;
  year: number;
  title: string;
  detail: string;
  opensOn: string;
  deadline: string;
  // Between opening and its deadline: Jane brings it up now.
  open: boolean;
  advice: boolean;
  amountCents: number | null;
  ownMessage: boolean;
  // The reminder Jane puts on the deadlines.
  task: { title: string; dueOn: string; note: string };
};

const DAY_MS = 86_400_000;
const dateOf = (year: number, d: PlanDate) => `${year + (d.nextYear ? 1 : 0)}-${d.md}`;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const shortDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const EVENT_NAMES: Readonly<Record<string, string>> = {
  new_job: "your new job",
  new_baby: "your new baby",
};

export function taxPlan(f: PlanFacts): PlanMove[] {
  const moves: PlanMove[] = [];
  const add = (
    key: PlanMoveKey,
    detail: string,
    amountCents: number | null,
    dates?: { opensOn: string; deadline: string; title?: string },
  ) => {
    const rule = TAX_PLAN[key];
    if (rule.advice && !f.advice) return;
    const opensOn = dates?.opensOn ?? dateOf(f.year, rule.opens);
    const deadline = dates?.deadline ?? dateOf(f.year, rule.deadline);
    const title = dates?.title ?? rule.title;
    moves.push({
      id: `${f.year}:${key}`,
      key,
      year: f.year,
      title,
      detail,
      opensOn,
      deadline,
      open: opensOn <= f.today && f.today <= deadline,
      advice: rule.advice,
      amountCents,
      ownMessage: Boolean(rule.ownMessage),
      task: { title: `${title} (${f.year} taxes)`, dueOn: deadline, note: detail },
    });
  };
  const saving = (key: SavingKey) => f.savings.find((s) => s.key === key);
  const saves = (cents: number) => (cents > 0 ? ` It could save about ${dollars(cents)}.` : "");

  const retirement = saving("retirement");
  if (retirement) {
    add(
      "workplace_retirement",
      `${retirement.title}: payroll contributions for ${f.year} end with your last paycheck.${saves(retirement.estimateCents)}`,
      null,
    );
  }
  const ira = saving("ira");
  if (ira) {
    add(
      "ira",
      `${ira.title}. You can make it until the April filing deadline.${saves(ira.estimateCents)}`,
      null,
    );
  }
  const hsa = saving("hsa");
  if (hsa) {
    add(
      "hsa",
      `Contributions for ${f.year} can go in until the April filing deadline.${saves(hsa.estimateCents)}`,
      null,
    );
  }
  const fsa = saving("health_fsa") ?? saving("dependent_care");
  if (fsa) add("fsa_enroll", `${fsa.title}.${saves(fsa.estimateCents)}`, null);

  // Each estimated payment by its due date (the four dates in TAX_PLAN).
  for (const n of [1, 2, 3, 4] as const) {
    const key = `estimated_${n}` as const;
    const due = dateOf(f.year, TAX_PLAN[key].deadline);
    const payment = f.estimated.find((p) => p.date === due);
    if (payment) {
      add(
        key,
        `About ${dollars(payment.cents)} for ${f.year}, by ${shortDay(due)}.`,
        payment.cents,
      );
    }
  }

  if (f.harvest) {
    add(
      "harvest",
      `${f.harvest.name} is down about ${dollars(f.harvest.lossCents)}. A sale by December 31 counts for ${f.year}; buying it back within 30 days is a wash sale.`,
      f.harvest.lossCents,
    );
  }
  if (f.donationsCents > 0 || saving("bunch_gifts") || saving("itemize")) {
    add(
      "giving",
      `Gifts count in the year they're made${f.donationsCents > 0 ? `: ${dollars(f.donationsCents)} so far in ${f.year}` : ""}. Keep the receipts.`,
      null,
    );
  }

  // A W-4 check within W4_AFTER_EVENT_DAYS of the latest new job or baby in the year.
  const event = f.lifeEvents
    .filter(
      (e) =>
        (W4_LIFE_EVENTS as readonly string[]).includes(e.kind) &&
        e.startedOn.startsWith(String(f.year)),
    )
    .sort((a, b) => b.startedOn.localeCompare(a.startedOn))[0];
  if (event) {
    const name = EVENT_NAMES[event.kind] ?? "your life change";
    add(
      "w4_life_event",
      `With ${name}, what's withheld from your pay may need to change. The IRS estimator on irs.gov/w4 tells you what to put.`,
      null,
      {
        opensOn: event.startedOn,
        deadline: addDays(event.startedOn, W4_AFTER_EVENT_DAYS),
        title: `Check your W-4 after ${name}`,
      },
    );
  }
  if (!f.filed) {
    add("file", `Your ${f.year} return is due April 15 (October 15 with an extension).`, null);
  }

  return moves
    .filter((m) => m.deadline >= f.today)
    .sort(
      (a, b) =>
        a.deadline.localeCompare(b.deadline) ||
        PLAN_ORDER.indexOf(a.key) - PLAN_ORDER.indexOf(b.key),
    );
}
