import type { PrismaClient } from "@/generated/prisma/client";
import { loadBnpl } from "@/lib/bnpl";
import { MIN_SAVING_CENTS } from "@/config/location";
import { loadCash } from "@/lib/investments/cash";
import { loadLocation } from "@/lib/investments/location";
import { loadCompanyStock } from "@/lib/investments/company-stock";
import { loadValues } from "@/lib/investments/values";
import { todayOf } from "@/lib/today";
import { cashCard, cashToBringUp } from "./investments/cash-copy";
import { companySellCard } from "./investments/company-copy";
import { locationCard } from "./investments/location-copy";
import { valuesCard } from "./investments/values-copy";
import { bnplPayoffCard } from "./sources/bnpl";
import type { Candidate, ChatMessage } from "./types";

// Cards that ask the person to act on a plan whose figures move with prices and balances: the cash
// plan (#2221), the switches a values list asks for, the company stock's part that's due, the
// location swaps and a Pay in 4 plan free to pay off (debug 3, 11-23: keyed by each day's figures,
// gate C's equity person had one of each a day). Each is
// posted under what it asks, said again by stillTrue with today's figures, buttons and plan key
// (./still-true.ts), and one at a time: the newest says it.
export const PLAN_REFS = [
  "cashPlan",
  "valuesKey",
  "companyPlan",
  "locationKey",
  "bnplPlan",
] as const;
export type PlanRef = (typeof PLAN_REFS)[number];
export type PlanCard = Pick<Candidate, "kind" | "body" | "refs" | "actions">;

// The plan a card still asking is about (one answered keeps what was chosen).
export const planRefOf = (m: ChatMessage): PlanRef | null =>
  m.status === "open" ? (PLAN_REFS.find((r) => m.refs[r] !== undefined) ?? null) : null;

// Each plan's card as it would be posted today, or null when there's none to bring up.
export async function plansNow(
  userId: string,
  refs: ReadonlySet<PlanRef>,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Partial<Record<PlanRef, PlanCard | null>>> {
  const cards: Partial<Record<PlanRef, PlanCard | null>> = {};
  if (refs.has("cashPlan")) {
    const plan = cashToBringUp(await loadCash(userId, { client, now }));
    cards.cashPlan = plan ? cashCard(plan) : null;
  }
  if (refs.has("valuesKey")) {
    const view = await loadValues(userId, { client, now });
    cards.valuesKey = view.advice ? valuesCard(view) : null;
  }
  if (refs.has("companyPlan")) {
    const view = await loadCompanyStock(userId, { client, now });
    cards.companyPlan =
      view.advice && view.concentration.overLimit
        ? companySellCard(view, await todayOf(userId, { client, now }))
        : null;
  }
  if (refs.has("locationKey")) {
    const view = await loadLocation(userId, { client, now });
    const plan = view.plan;
    cards.locationKey =
      view.advice && plan && plan.savedCents >= MIN_SAVING_CENTS && plan.swaps.length > 0
        ? locationCard(plan)
        : null;
  }
  if (refs.has("bnplPlan")) {
    const data = await loadBnpl(userId, { client, now });
    cards.bnplPlan = data.available ? (bnplPayoffCard(data)?.card ?? null) : null;
  }
  return cards;
}
