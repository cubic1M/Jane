import type { SavedItem } from "@/lib/membership/service";
import {
  AREA_HEALTH_PARTS,
  AREA_KEYS,
  CASH_FLOW_DAYS,
  GOALS_SHOWN,
  HEALTH_LOOK_BELOW,
  PLAN_SHOWN,
  SAFE_BILLS_SHOWN,
  SAVED_SHOWN,
  areaOfCapability,
  type AreaKey,
} from "@/config/areas";
import type { HealthPart } from "@/config/health-score";
import { AREA_TABS } from "@/config/navigation";
import { formatCents } from "@/lib/money";
import { monthLabel } from "@/lib/day-label";

// The home hub's view model (docs/design/home-hub.md): the numbers the hub's loader gathered
// from the pages that already show them, shaped for the charts. Pure, and no new math: it only
// picks, orders, labels and scales what it is given.

export type Health = "good" | "look" | "act";

// --- Input: what ./load.ts gathers ---

export type SafeInput = {
  payday: string | null;
  balanceCents: number;
  billsCents: number;
  budgetsLeftCents: number;
  goalsCents: number;
  setAsideCents: number;
  safeCents: number;
  // The bills before payday, one by one (src/planning/safe-to-spend.ts).
  bills?: { merchant: string; date: string; amountCents: number }[];
};

export type HeroInput = {
  asOf: string;
  safe: SafeInput | null;
  netWorth: { todayCents: number; months: { month: string; netCents: number | null }[] } | null;
  foundCents: number;
  savedCents: number;
  // What the saved total is made of, biggest first (savedItems, src/lib/membership/service.ts).
  savedItems?: SavedItem[];
  // What the person's transactions confirm (the verified savings record), a year.
  confirmedCents?: number;
  // Jane's plan (src/lib/home.ts): how many things, their yearly total if the person says yes to
  // all, and the biggest few.
  plan?: { items: number; annualSavingsCents: number; top: { title: string; cents: number }[] };
  // The goal savings go toward: the first one not reached yet.
  goal?: { name: string; percent: number } | null;
};

export type CashFlowInput = {
  asOf: string;
  bills: { merchant: string; date: string; amountCents: number }[];
  deposits: { merchant: string; date: string; amountCents: number }[];
  deadlines: { key: string; title: string; date: string; href: string | null }[];
};

export type AreasInput = {
  // The money health score's parts, when there is a score.
  parts: { part: HealthPart; points: number; max: number }[];
  // Suggestions waiting for the person (the day's and the rest), by capability.
  suggestions: { capability: string; urgency: string }[];
  safeShort: boolean;
  money: {
    months: { month: string; spendingCents: number }[];
    budgetsOver: number;
  } | null;
  insurance: { policies: number; gaps: number } | null;
  loans: {
    owedCents: number;
    lines: { name: string; balanceCents: number | null; overdue: boolean }[];
  } | null;
  taxes: {
    totalTaxCents: number;
    paidCents: number;
    refundCents: number;
    withholdingKnown: boolean;
  } | null;
  investments: {
    totalCents: number;
    // All the practice money put in (start and monthly adds): up or down is against this.
    paidInCents: number;
    parts: { label: string; valueCents: number }[];
  } | null;
  ahead: {
    goals: { name: string; percent: number; onTrack: boolean }[];
  } | null;
};

// --- Output: what the hub draws ---

export type SafeHero = {
  label: string;
  cents: number;
  short: boolean;
  // Today's checking balance, split into where it goes; shares add up to 1.
  parts: { key: string; label: string; cents: number; share: number }[];
  // Why it's that number (founder: "it should expand first having a summary on why that number
  // is what it is"): the balance now, less each thing held back, equals it. 3 to 6 lines.
  why: CalcLine[];
  // "How it's worked out" (founder: "show a pop up page … right next to it showing the
  // calculations"): the same sum with each bill on its own line.
  steps: CalcLine[];
};

// One line of a worked-out sum: what it is, its sign, the amount, and a note (a bill's date).
export type CalcLine = { label: string; sign: "" | "−" | "+" | "="; cents: number; note?: string };

// "Your plan" beside Saved so far (founder: "Same for the Your plan next to saved so far"):
// what's saved and where from, what the plan adds, and the goal it goes toward.
export type PlanHero = {
  count: number;
  steps: CalcLine[];
  goal: { name: string; percent: number } | null;
};

export type NetWorthHero = {
  cents: number;
  // The 12 months' values, oldest first (months with no balances left out).
  points: { month: string; cents: number }[];
  trend: "up" | "down" | "flat";
};

export type SavedHero = {
  label: string;
  cents: number;
  perYear: boolean;
  share: number;
  // Where it came from (founder: "click on it, it expands and shows a summary of where was
  // saved"): the biggest few, and how many more.
  items: SavedItem[];
  more: number;
  // What the person's own transactions confirm: the number "Saved so far" shows (0 until
  // something shows).
  confirmedCents: number;
  // What they said yes to or did that isn't confirmed yet, a year: shown apart, labelled
  // (QA round 11: "Saved so far" had counted it).
  expectedCents: number;
};

export type HeroView = {
  safe: SafeHero | null;
  netWorth: NetWorthHero | null;
  saved: SavedHero;
  plan: PlanHero | null;
};

export type CashEvent = {
  key: string;
  kind: "bill" | "pay" | "deadline";
  day: number;
  date: string;
  label: string;
  amountCents: number | null;
  // 0–1, the event's size against the biggest one of its kind.
  weight: number;
  href: string | null;
};

export type CashFlowView = { days: number; events: CashEvent[] };

// The strip's markers: a day's events of one kind are one marker (tap audit: two bills on Nov 1
// drew on top of each other and only one could be tapped), its card listing them all, sized
// by the biggest. In date order, paydays before bills before dates on the same day.
export type CashGroup = {
  key: string;
  kind: CashEvent["kind"];
  day: number;
  date: string;
  weight: number;
  events: CashEvent[];
};

export function cashGroups(events: readonly CashEvent[]): CashGroup[] {
  const order: Record<CashEvent["kind"], number> = { pay: 0, bill: 1, deadline: 2 };
  const groups = new Map<string, CashGroup>();
  for (const e of events) {
    const key = `${e.kind}|${e.day}`;
    const g = groups.get(key);
    if (g) {
      g.events.push(e);
      g.weight = Math.max(g.weight, e.weight);
    } else {
      groups.set(key, {
        key,
        kind: e.kind,
        day: e.day,
        date: e.date,
        weight: e.weight,
        events: [e],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.day - b.day || order[a.kind] - order[b.kind]);
}

export type TileChart =
  | { kind: "bars"; values: number[]; labels: string[] }
  | { kind: "squares"; filled: number; hollow: number }
  | { kind: "split"; parts: { label: string; share: number }[] }
  | { kind: "meter"; share: number; label: string }
  | { kind: "progress"; items: { label: string; share: number; onTrack: boolean }[] }
  | { kind: "none" };

export type AreaTile = {
  key: AreaKey;
  label: string;
  href: string;
  health: Health | null;
  // Why the dot is that colour, in a few words.
  healthWhy: string;
  value: string | null;
  caption: string;
  chart: TileChart;
};

// --- Formatting ---

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// "$48.2k", "$1.3M", "$640": a tile's number in a glance.
export function shortMoney(cents: number): string {
  const dollars = Math.round(cents / 100);
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}$${abs}`;
}

const wholeDollars = (cents: number) =>
  formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "");

const dayIndex = (asOf: string, date: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- The hero row ---

export function heroView(input: HeroInput): HeroView {
  return {
    safe: input.safe ? safeHero(input.safe) : null,
    netWorth: input.netWorth ? netWorthHero(input.netWorth) : null,
    saved: savedHero(
      input.foundCents,
      input.savedCents,
      input.savedItems ?? [],
      input.confirmedCents ?? 0,
    ),
    plan: planHero(input),
  };
}

function planHero(input: HeroInput): PlanHero | null {
  const plan = input.plan;
  if (!plan || plan.items === 0) return null;
  const saved = input.savedItems ?? [];
  const savedLines: CalcLine[] = saved.slice(0, SAVED_SHOWN).map((item) => ({
    label: item.title,
    note: item.yearly ? "a year" : "once",
    sign: "" as const,
    cents: item.cents,
  }));
  const savedRest = saved.slice(SAVED_SHOWN);
  if (savedRest.length > 0)
    savedLines.push({
      label: `${plural(savedRest.length, "more saving")}`,
      sign: "",
      cents: savedRest.reduce((sum, i) => sum + i.cents, 0),
    });
  const planLines: CalcLine[] = plan.top.slice(0, PLAN_SHOWN).map((t) => ({
    label: t.title,
    sign: "+" as const,
    cents: t.cents,
  }));
  const shown = planLines.reduce((sum, l) => sum + l.cents, 0);
  const others = plan.items - planLines.length;
  if (others > 0)
    planLines.push({
      label: plural(others, "more thing"),
      sign: "+",
      cents: Math.max(0, plan.annualSavingsCents - shown),
    });
  const steps: CalcLine[] =
    input.savedCents > 0
      ? [
          ...savedLines,
          { label: "Expected so far", sign: "=", cents: input.savedCents },
          ...planLines,
          {
            label: "Expected, plus your plan if you say yes",
            sign: "=",
            cents: input.savedCents + plan.annualSavingsCents,
          },
        ]
      : [
          ...planLines,
          { label: "Your plan, if you say yes to all", sign: "=", cents: plan.annualSavingsCents },
        ];
  return { count: plan.items, steps, goal: input.goal ?? null };
}

function safeHero(safe: SafeInput): SafeHero {
  const short = safe.safeCents < 0;
  const raw = [
    { key: "bills", label: "Bills before payday", cents: safe.billsCents },
    { key: "budgets", label: "Left in budgets", cents: safe.budgetsLeftCents },
    { key: "goals", label: "Goals", cents: safe.goalsCents },
    { key: "setAside", label: "Yearly bills", cents: safe.setAsideCents },
    { key: "safe", label: "Safe to spend", cents: Math.max(0, safe.safeCents) },
  ].filter((p) => p.cents > 0);
  const total = raw.reduce((sum, p) => sum + p.cents, 0);
  const held = [
    {
      label: `Bills before ${safe.payday ? shortDate(safe.payday) : "payday"}`,
      cents: safe.billsCents,
    },
    { label: "Left in your budgets", cents: safe.budgetsLeftCents },
    { label: "Goals this month", cents: safe.goalsCents },
    { label: "Set aside for yearly bills", cents: safe.setAsideCents },
  ].filter((l) => l.cents > 0);
  return {
    label: safe.payday ? `Safe to spend until ${shortDate(safe.payday)}` : "Safe to spend",
    cents: short ? -safe.safeCents : safe.safeCents,
    short,
    parts: raw.map((p) => ({ ...p, share: total > 0 ? p.cents / total : 0 })),
    why: [
      { label: "In checking now", sign: "", cents: safe.balanceCents },
      ...held.map((l) => ({ ...l, sign: "−" as const })),
      { label: short ? "Short before payday" : "Safe to spend", sign: "=", cents: safe.safeCents },
    ],
    steps: safeSteps(safe, short),
  };
}

function safeSteps(safe: SafeInput, short: boolean): CalcLine[] {
  const bills = [...(safe.bills ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const billLines: CalcLine[] =
    bills.length === 0
      ? safe.billsCents > 0
        ? [{ label: "Bills before payday", sign: "−", cents: safe.billsCents }]
        : []
      : bills.slice(0, SAFE_BILLS_SHOWN).map((b) => ({
          label: b.merchant,
          note: shortDate(b.date),
          sign: "−" as const,
          cents: b.amountCents,
        }));
  const rest = bills.slice(SAFE_BILLS_SHOWN);
  if (rest.length > 0)
    billLines.push({
      label: plural(rest.length, "more bill"),
      sign: "−",
      cents: rest.reduce((sum, b) => sum + b.amountCents, 0),
    });
  const held: CalcLine[] = [
    { label: "Left in your budgets", sign: "−" as const, cents: safe.budgetsLeftCents },
    { label: "Planned savings: goals this month", sign: "−" as const, cents: safe.goalsCents },
    { label: "Set aside for yearly bills", sign: "−" as const, cents: safe.setAsideCents },
  ].filter((l) => l.cents > 0);
  return [
    { label: "In checking today", sign: "", cents: safe.balanceCents },
    ...billLines,
    ...held,
    {
      label: short ? "Short before payday" : "Safe to spend",
      sign: "=",
      cents: safe.safeCents,
    },
  ];
}

function netWorthHero(nw: NonNullable<HeroInput["netWorth"]>): NetWorthHero {
  const points = nw.months.flatMap((m) =>
    m.netCents === null ? [] : [{ month: m.month, cents: m.netCents }],
  );
  const first = points[0]?.cents;
  const last = points.at(-1)?.cents;
  const moved = first === undefined || last === undefined ? 0 : last - first;
  // Under 1% of the year's start either way reads as flat.
  const flat = Math.abs(moved) <= Math.abs(first ?? 0) * 0.01;
  return {
    cents: nw.todayCents,
    points,
    trend: flat ? "flat" : moved > 0 ? "up" : "down",
  };
}

function savedHero(
  foundCents: number,
  savedCents: number,
  items: SavedItem[],
  confirmedCents: number,
): SavedHero {
  // Saved so far is confirmed money only (refunds once, lower bills and stopped charges a year),
  // so it carries no "/yr"; what's still expected is beside it, labelled.
  if (savedCents > 0 || confirmedCents > 0) {
    return {
      label: "Saved so far",
      cents: confirmedCents,
      perYear: false,
      share: foundCents > 0 ? Math.min(1, confirmedCents / foundCents) : confirmedCents > 0 ? 1 : 0,
      items: items.slice(0, SAVED_SHOWN),
      more: Math.max(0, items.length - SAVED_SHOWN),
      confirmedCents,
      expectedCents: Math.max(0, savedCents - confirmedCents),
    };
  }
  return {
    label: "Money found",
    cents: foundCents,
    perYear: true,
    share: 0,
    items: [],
    more: 0,
    confirmedCents: 0,
    expectedCents: 0,
  };
}

// --- The cash-flow strip ---

export function cashFlowView(input: CashFlowInput, days = CASH_FLOW_DAYS): CashFlowView {
  const inWindow = (date: string) => {
    const d = dayIndex(input.asOf, date);
    return d >= 0 && d <= days;
  };
  const bills = input.bills.filter((b) => inWindow(b.date));
  const pays = input.deposits.filter((p) => inWindow(p.date));
  const maxBill = Math.max(1, ...bills.map((b) => b.amountCents));
  const maxPay = Math.max(1, ...pays.map((p) => p.amountCents));
  const events: CashEvent[] = [
    ...bills.map((b, i) => ({
      key: `bill-${i}-${b.date}`,
      kind: "bill" as const,
      day: dayIndex(input.asOf, b.date),
      date: b.date,
      label: b.merchant,
      amountCents: b.amountCents,
      weight: b.amountCents / maxBill,
      href: "/bills",
    })),
    ...pays.map((p, i) => ({
      key: `pay-${i}-${p.date}`,
      kind: "pay" as const,
      day: dayIndex(input.asOf, p.date),
      date: p.date,
      label: p.merchant,
      amountCents: p.amountCents,
      weight: p.amountCents / maxPay,
      href: "/transfers",
    })),
    ...input.deadlines
      .filter((d) => inWindow(d.date))
      // A deadline about a bill already on the strip (same day, its name) is that bill.
      .filter(
        (d) =>
          !bills.some(
            (b) => b.date === d.date && d.title.toLowerCase().includes(b.merchant.toLowerCase()),
          ),
      )
      .map((d) => ({
        key: `deadline-${d.key}`,
        kind: "deadline" as const,
        day: dayIndex(input.asOf, d.date),
        date: d.date,
        label: d.title,
        amountCents: null,
        weight: 0.5,
        href: d.href ?? "/deadlines",
      })),
  ];
  events.sort((a, b) => a.day - b.day || a.kind.localeCompare(b.kind));
  return { days, events };
}

// --- The area tiles ---

function areaHealth(
  key: AreaKey,
  input: AreasInput,
  hard: { act: string | null; look: string | null },
): { health: Health; why: string } {
  const mine = input.suggestions.filter((s) => areaOfCapability(s.capability) === key);
  const urgent = mine.filter((s) => s.urgency === "now").length;
  if (hard.act) return { health: "act", why: hard.act };
  if (urgent > 0) return { health: "act", why: `${plural(urgent, "thing")} to do now` };
  if (hard.look) return { health: "look", why: hard.look };
  if (mine.length > 0) return { health: "look", why: `${plural(mine.length, "idea")} for you` };
  const weak = input.parts.filter(
    (p) => AREA_HEALTH_PARTS[key].includes(p.part) && p.points < p.max * HEALTH_LOOK_BELOW,
  );
  if (weak.length > 0) return { health: "look", why: "Room to improve" };
  return { health: "good", why: "All good" };
}

const TAB = Object.fromEntries(AREA_TABS.map((t) => [t.key, t]));

function tile(
  key: AreaKey,
  input: AreasInput,
  hasData: boolean,
  parts: Omit<AreaTile, "key" | "label" | "href" | "health" | "healthWhy">,
  hard: { act?: string | null; look?: string | null } = {},
): AreaTile {
  const health = hasData
    ? areaHealth(key, input, { act: hard.act ?? null, look: hard.look ?? null })
    : null;
  return {
    key,
    label: TAB[key].label,
    href: TAB[key].href,
    health: health?.health ?? null,
    healthWhy: health?.why ?? "Not set up",
    ...parts,
  };
}

export function tilesView(input: AreasInput): AreaTile[] {
  const tiles: Record<AreaKey, AreaTile> = {
    money: (() => {
      const m = input.money;
      const thisMonth = m?.months.at(-1)?.spendingCents ?? 0;
      return tile(
        "money",
        input,
        m !== null,
        {
          value: m ? shortMoney(thisMonth) : null,
          caption: m ? "Spent this month" : "Link a bank to see it",
          chart: m
            ? {
                kind: "bars",
                values: m.months.map((x) => Math.max(0, x.spendingCents)),
                labels: m.months.map((x) => monthLabel(x.month, { year: false })),
              }
            : { kind: "none" },
        },
        {
          act: input.safeShort ? "Short before payday" : null,
          look: m && m.budgetsOver > 0 ? `${plural(m.budgetsOver, "budget")} over` : null,
        },
      );
    })(),
    insurance: (() => {
      const i = input.insurance;
      const known = i !== null && i.policies + i.gaps > 0;
      return tile(
        "insurance",
        input,
        known,
        {
          value: known
            ? i.gaps > 0
              ? plural(i.gaps, "gap")
              : plural(i.policies, "policy", "policies")
            : null,
          caption: known ? (i.gaps > 0 ? "In your cover" : "Covered") : "Add your policies",
          chart: known ? { kind: "squares", filled: i.policies, hollow: i.gaps } : { kind: "none" },
        },
        { look: known && i.gaps > 0 ? `${plural(i.gaps, "gap")} in cover` : null },
      );
    })(),
    loans: (() => {
      const l = input.loans;
      const known = l !== null && l.lines.length > 0;
      const overdue = l?.lines.filter((x) => x.overdue).length ?? 0;
      const owed = l?.lines.reduce((sum, x) => sum + (x.balanceCents ?? 0), 0) ?? 0;
      return tile(
        "loans",
        input,
        known,
        {
          value: known ? shortMoney(l.owedCents) : null,
          caption: known
            ? `Owed on ${plural(l.lines.length, "account")}`
            : "No loans or cards linked",
          chart:
            known && owed > 0
              ? {
                  kind: "split",
                  parts: l.lines
                    .filter((x) => (x.balanceCents ?? 0) > 0)
                    .sort((a, b) => (b.balanceCents ?? 0) - (a.balanceCents ?? 0))
                    .map((x) => ({ label: x.name, share: (x.balanceCents ?? 0) / owed })),
                }
              : { kind: "none" },
        },
        { act: overdue > 0 ? `${plural(overdue, "payment")} overdue` : null },
      );
    })(),
    taxes: (() => {
      const t = input.taxes;
      const known = t !== null && t.totalTaxCents > 0;
      const refund = t?.refundCents ?? 0;
      return tile("taxes", input, known, {
        value: known
          ? t.withholdingKnown
            ? refund >= 0
              ? `+${shortMoney(refund)}`
              : shortMoney(-refund)
            : shortMoney(t.totalTaxCents)
          : null,
        caption: known
          ? t.withholdingKnown
            ? refund >= 0
              ? "Refund, estimated"
              : "To pay, estimated"
            : "Tax this year, estimated"
          : "Not enough to estimate yet",
        chart: known
          ? {
              kind: "meter",
              share: Math.min(1, t.paidCents / t.totalTaxCents),
              label: "Paid in so far",
            }
          : { kind: "none" },
      });
    })(),
    investments: (() => {
      const p = input.investments;
      const total = p?.parts.reduce((sum, x) => sum + x.valueCents, 0) ?? 0;
      return tile("investments", input, p !== null, {
        value: p ? shortMoney(p.totalCents) : null,
        caption: p
          ? p.totalCents >= p.paidInCents
            ? "Practice money, up"
            : "Practice money, down"
          : "Start with practice money",
        chart:
          p && total > 0
            ? {
                kind: "split",
                parts: [...p.parts]
                  .sort((a, b) => b.valueCents - a.valueCents)
                  .map((x) => ({ label: x.label, share: x.valueCents / total })),
              }
            : { kind: "none" },
      });
    })(),
    ahead: (() => {
      const g = input.ahead?.goals ?? [];
      const onTrack = g.filter((x) => x.onTrack).length;
      return tile(
        "ahead",
        input,
        g.length > 0,
        {
          value: g.length > 0 ? `${onTrack} of ${g.length}` : null,
          caption: g.length > 0 ? "Goals on track" : "Set a goal",
          chart:
            g.length > 0
              ? {
                  kind: "progress",
                  items: g.slice(0, GOALS_SHOWN).map((x) => ({
                    label: x.name,
                    share: Math.min(1, Math.max(0, x.percent / 100)),
                    onTrack: x.onTrack,
                  })),
                }
              : { kind: "none" },
        },
        { look: g.length > onTrack ? `${plural(g.length - onTrack, "goal")} behind` : null },
      );
    })(),
  };
  return AREA_KEYS.map((key) => tiles[key]);
}

// What a tile's chart says, for screen readers.
export function chartText(chart: TileChart): string {
  switch (chart.kind) {
    case "bars":
      return chart.values.map((v, i) => `${chart.labels[i]} ${wholeDollars(v)}`).join(", ");
    case "squares":
      return `${plural(chart.filled, "policy", "policies")}, ${plural(chart.hollow, "gap")}`;
    case "split":
      return chart.parts.map((p) => `${p.label} ${Math.round(p.share * 100)}%`).join(", ");
    case "meter":
      return `${chart.label}: ${Math.round(chart.share * 100)}%`;
    case "progress":
      return chart.items
        .map((g) => `${g.label} ${Math.round(g.share * 100)}%${g.onTrack ? "" : ", behind"}`)
        .join("; ");
    case "none":
      return "";
  }
}
