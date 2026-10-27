import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { RISK_LEVELS, type RiskLevel } from "@/config/investing";
import { AUTOPILOT_CONFIDENCE, PRACTICE_NOTE } from "@/config/practice-cards";
import { AUTOPILOT_LIMITS } from "@/config/portfolios";
import { SCAN_KINDS, SCAN_LABELS, type ScanKind } from "@/config/practice-scan";
import type { FloatingCardData } from "@/lib/floating-cards";
import { formatPercent as pct } from "@/lib/percent";
import { formatWholeDollars } from "@/lib/money";

// The practice portfolio's cards in the chat (spec step 296, Phase AW, Stage A), in the chat
// lane's floating-card shape (src/lib/floating-cards.ts). Pure. Each card is short (what, how
// much, why in a sentence); More details holds the rule, the numbers, the caps and how sure Jane
// is, with the reason. The one button opens the pause switch: a card never buys anything, and
// nothing in a practice portfolio is real.

export type OpportunityRow = {
  id: string;
  kind: string;
  headline: string;
  reason: string;
  confidence: number;
  status: string;
  // As the scan stored it (src/lib/practice/scan.ts).
  details: unknown;
};

export type TradeRow = {
  id: string;
  placedAt: Date;
  side: string;
  ticker: string | null;
  amountCents: number;
  reason: string;
  rule: string;
};

export const WHAT_YES_DOES =
  "Opens the pause switch for your practice portfolio. Nothing is bought or sold.";
const YES = "Pause switch";
const NOT_NOW = "Got it";

const exact = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Stored = {
  figures: { label: string; value: string }[];
  caps: string[];
  confidence: { percent: number; reason: string } | null;
  heldBy: string | null;
};

// Reads what the scan stored, keeping only the shapes the card shows.
function stored(details: unknown): Stored {
  const d = (details ?? {}) as Record<string, unknown>;
  const figures: Stored["figures"] = [];
  for (const f of Array.isArray(d.figures) ? d.figures : []) {
    const x = (f ?? {}) as Record<string, unknown>;
    if (typeof x.label === "string" && typeof x.value === "string") {
      figures.push({ label: x.label, value: x.value });
    }
  }
  const caps: string[] = [];
  for (const c of Array.isArray(d.caps) ? d.caps : []) {
    if (typeof c === "string") caps.push(c);
  }
  const c = d.confidence as { percent?: unknown; reason?: unknown } | undefined;
  const confidence =
    typeof c?.percent === "number" && typeof c.reason === "string"
      ? { percent: c.percent, reason: c.reason }
      : null;
  return { figures, caps, confidence, heldBy: typeof d.heldBy === "string" ? d.heldBy : null };
}

const isKind = (k: string): k is ScanKind => (SCAN_KINDS as readonly string[]).includes(k);

export function opportunityCard(o: OpportunityRow): FloatingCardData {
  const d = stored(o.details);
  const label = isKind(o.kind) ? SCAN_LABELS[o.kind] : o.kind;
  const status =
    o.status === "held"
      ? `Not done: ${d.heldBy ?? "a cap"}`
      : o.status === "autopilot"
        ? "The autopilot makes the trades"
        : "Done in the practice portfolio";
  return {
    id: `opportunity:${o.id}`,
    headline: o.status === "held" ? `Held back: ${label}` : o.headline,
    details: {
      why: o.reason,
      figures: [{ label: "Rule", value: label }, ...d.figures, { label: "Status", value: status }],
      confidence: d.confidence ?? {
        percent: o.confidence,
        reason: "How sure Jane is about this kind of move.",
      },
      whatYesDoes: WHAT_YES_DOES,
      notes: [DEMO_ADVICE_LABEL, PRACTICE_NOTE, ...d.caps.map((c) => `Cap: ${c}`)],
    },
    yesLabel: YES,
    notNowLabel: NOT_NOW,
  };
}

const AUTOPILOT_CAPS = [
  `Rebalanced when a kind is ${pct(AUTOPILOT_LIMITS.rebalanceBand)} off its target`,
  `No trade over ${pct(AUTOPILOT_LIMITS.perTradeShare)} of the portfolio`,
  `No fund over ${pct(AUTOPILOT_LIMITS.perEtfShare)} of the portfolio`,
  `At most ${AUTOPILOT_LIMITS.tradesPerDay} trades a day`,
  "No borrowing, no options, no selling short",
];

// One card for the autopilot's trades on one day (buying the model, rebalancing).
export function tradesCard(day: string, level: RiskLevel, trades: TradeRow[]): FloatingCardData {
  const placed = trades.filter((t) => t.side === "buy" || t.side === "sell");
  const bought = placed.filter((t) => t.side === "buy").reduce((s, t) => s + t.amountCents, 0);
  const sold = placed.filter((t) => t.side === "sell").reduce((s, t) => s + t.amountCents, 0);
  const first = placed.some((t) => t.rule === "model_buy");
  const name = RISK_LEVELS[level].label;
  const headline = first
    ? `Bought the ${name} model for ${formatWholeDollars(bought)}`
    : `Rebalanced ${formatWholeDollars(Math.max(bought, sold))} back to your mix`;
  const why = first
    ? `Jane bought the model portfolio for your level (${name}) with practice money, in ${placed.length} trades.`
    : `Your mix had drifted from the ${name} model, so Jane moved it back in ${placed.length} trades.`;
  return {
    id: `trades:${day}`,
    headline,
    details: {
      why,
      figures: [
        { label: "Rule", value: first ? "Buy the model" : "Rebalance past the band" },
        ...placed.map((t) => ({
          label: `${t.side === "buy" ? "Bought" : "Sold"} ${t.ticker}`,
          value: exact(t.amountCents),
        })),
      ],
      confidence: AUTOPILOT_CONFIDENCE,
      whatYesDoes: WHAT_YES_DOES,
      notes: [DEMO_ADVICE_LABEL, PRACTICE_NOTE, ...AUTOPILOT_CAPS.map((c) => `Cap: ${c}`)],
    },
    yesLabel: YES,
    notNowLabel: NOT_NOW,
  };
}

// The autopilot's trades grouped by day (UTC), newest day first.
export function tradeDays(trades: TradeRow[]): { day: string; trades: TradeRow[] }[] {
  const byDay = new Map<string, TradeRow[]>();
  for (const t of trades) {
    const day = t.placedAt.toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({ day, trades: list }));
}
