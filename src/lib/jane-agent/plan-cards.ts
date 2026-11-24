import type { PrismaClient } from "@/generated/prisma/client";
import { loadBnpl } from "@/lib/bnpl";
import { MIN_SAVING_CENTS } from "@/config/location";
import { loadCash } from "@/lib/investments/cash";
import { loadLocation } from "@/lib/investments/location";
import { loadCompanyStock } from "@/lib/investments/company-stock";
import { loadShortTerm } from "@/lib/investments/short-term";
import { loadValues } from "@/lib/investments/values";
import { todayOf } from "@/lib/today";
import { cashCard, cashToBringUp } from "./investments/cash-copy";
import { companySellCard } from "./investments/company-copy";
import { locationCard } from "./investments/location-copy";
import { shortTermCard, shortTermToBringUp } from "./investments/short-term-copy";
import { valuesCard } from "./investments/values-copy";
import { bnplPayoffCard } from "./sources/bnpl";
import type { Candidate, ChatMessage } from "./types";

// Cards that ask the person to act on a plan whose figures move with prices and balances: the cash
// plan (#2221), the switches a values list asks for, the company stock's part that's due, the
// location swaps, a Pay in 4 plan free to pay off (debug 3, 11-23: keyed by each day's figures,
// gate C's equity person had one of each a day) and short-term money's place (11-24: one card a
// goal or the emergency fund, keyed by its amount). Each is posted under what it asks, said again
// by stillTrue with today's figures, buttons and plan key (./still-true.ts), and one at a time a
// plan (a short-term card a candidate): the newest says it.
export const PLAN_REFS = [
  "cashPlan",
  "valuesKey",
  "companyPlan",
  "locationKey",
  "bnplPlan",
  "shortKey",
] as const;
export type PlanRef = (typeof PLAN_REFS)[number];
export type PlanCard = Pick<Candidate, "kind" | "body" | "refs" | "actions">;

// The short-term money a card is about. A ladder card posted before shortKey (11-24) has only its
// ladderKey, the same candidate key; a chat reply's ladderKey isn't a card (kind "reply").
const shortKeyOf = (m: ChatMessage) =>
  m.refs.shortKey ?? (m.kind === "decision" ? m.refs.ladderKey : undefined);

// The plan a card still asking is about (one answered keeps what was chosen).
export const planRefOf = (m: ChatMessage): PlanRef | null =>
  m.status !== "open"
    ? null
    : (PLAN_REFS.find((r) => r !== "shortKey" && m.refs[r] !== undefined) ??
      (shortKeyOf(m) !== undefined ? "shortKey" : null));

// Which card of its plan a card is: the plan itself, or for short-term money its candidate.
export const planGroupOf = (m: ChatMessage): string | null => {
  const ref = planRefOf(m);
  return ref === "shortKey" ? `${ref}:${shortKeyOf(m)}` : ref;
};

// Each plan's card as it would be posted today, or null when there's none to bring up, by
// planGroupOf. Every plan looked at has its own entry (short-term money's is null, its cards by
// candidate beside it), so a card missing from what's here has nothing to bring up.
export async function plansNow(
  userId: string,
  refs: ReadonlySet<PlanRef>,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Map<string, PlanCard | null>> {
  const cards = new Map<string, PlanCard | null>();
  if (refs.has("cashPlan")) {
    const plan = cashToBringUp(await loadCash(userId, { client, now }));
    cards.set("cashPlan", plan ? cashCard(plan) : null);
  }
  if (refs.has("valuesKey")) {
    const view = await loadValues(userId, { client, now });
    cards.set("valuesKey", view.advice ? valuesCard(view) : null);
  }
  if (refs.has("companyPlan")) {
    const view = await loadCompanyStock(userId, { client, now });
    cards.set(
      "companyPlan",
      view.advice && view.concentration.overLimit
        ? companySellCard(view, await todayOf(userId, { client, now }))
        : null,
    );
  }
  if (refs.has("locationKey")) {
    const view = await loadLocation(userId, { client, now });
    const plan = view.plan;
    cards.set(
      "locationKey",
      view.advice && plan && plan.savedCents >= MIN_SAVING_CENTS && plan.swaps.length > 0
        ? locationCard(plan)
        : null,
    );
  }
  if (refs.has("bnplPlan")) {
    const data = await loadBnpl(userId, { client, now });
    cards.set("bnplPlan", data.available ? (bnplPayoffCard(data)?.card ?? null) : null);
  }
  if (refs.has("shortKey")) {
    const view = await loadShortTerm(userId, { client, now });
    cards.set("shortKey", null);
    for (const c of view.advice ? shortTermToBringUp(view.candidates) : [])
      cards.set(`shortKey:${c.key}`, shortTermCard(c));
  }
  return cards;
}
