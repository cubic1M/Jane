import { randomUUID } from "node:crypto";
import {
  VALUES_EXCLUSIONS,
  VALUES_NOTE,
  VALUES_SOURCE,
  VALUES_THEMES,
  type Exclusion,
  type Theme,
} from "@/config/values";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { valuesPlan, type Prefs, type ValuesPlan } from "@/planning/values";
import { loadInvestments } from "./holdings";

// Investing by your values (spec step 236): the person's list, the plan that applies it to
// the funds they hold, and the tap that makes the switches through the brokerage partner.
// The same list steers what the rebalance buys. Moving money always waits for the tap.

type Options = { client?: PrismaClient; now?: Date };

export class ValuesError extends Error {}

const isExclusion = (k: string): k is Exclusion => Object.hasOwn(VALUES_EXCLUSIONS, k);
const isTheme = (k: string): k is Theme => Object.hasOwn(VALUES_THEMES, k);

export async function loadPrefs(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<Prefs> {
  const row = await scopedFor(userId, client).valuesPreferences.findFirst({
    select: { excludes: true, themes: true },
  });
  return {
    excludes: (row?.excludes ?? []).filter(isExclusion),
    themes: (row?.themes ?? []).filter(isTheme),
  };
}

export async function savePrefs(
  userId: string,
  input: { excludes: string[]; themes: string[] },
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<Prefs> {
  const prefs: Prefs = {
    excludes: [...new Set(input.excludes)].filter(isExclusion),
    themes: [...new Set(input.themes)].filter(isTheme),
  };
  await client.valuesPreference.upsert({
    where: { userId },
    create: { userId, ...prefs },
    update: prefs,
  });
  await logAudit(
    { type: "user", id: userId },
    "values_saved",
    { type: "user", id: userId },
    {
      excludes: prefs.excludes.join(","),
      themes: prefs.themes.join(","),
    },
  );
  await track(userId, "values_saved", {
    excludes: prefs.excludes.length,
    themes: prefs.themes.length,
  });
  return prefs;
}

export type ValuesView = {
  advice: boolean;
  prefs: Prefs;
  plan: ValuesPlan | null;
  note: string;
  source: string;
};

export async function loadValues(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ValuesView> {
  const [prefs, advice, investments] = await Promise.all([
    loadPrefs(userId, { client }),
    adviceMode(userId, { client }),
    loadInvestments(userId, { client, now }),
  ]);
  return {
    advice,
    prefs,
    plan: advice ? valuesPlan(investments.accounts, prefs) : null,
    note: VALUES_NOTE,
    source: VALUES_SOURCE,
  };
}

// Tap: make the switches the person saw, only while the plan is still that plan. Sales first.
export async function applyValues(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ switches: number; plan: ValuesPlan }> {
  const view = await loadValues(userId, { client, now });
  if (!view.advice) throw new ValuesError("Switching funds is only in demo advice mode for now.");
  const plan = view.plan;
  if (!plan || plan.switches.length === 0) throw new ValuesError("Nothing to switch.");
  if (plan.key !== key) {
    throw new ValuesError(
      "Your investments or your list changed since this plan. Here's the new one.",
    );
  }
  const partner = brokeragePartner();
  const batchId = randomUUID();
  const sells = plan.switches.map((s) => ({
    accountId: s.accountId,
    ticker: s.from.ticker,
    securityName: s.from.name,
    side: "sell" as const,
    amountCents: s.from.valueCents,
  }));
  const buys = plan.switches.flatMap((s) =>
    s.legs.map((l) => ({
      accountId: s.accountId,
      ticker: l.ticker,
      securityName: l.name,
      side: "buy" as const,
      amountCents: l.amountCents,
    })),
  );
  await partner.placeOrders(
    userId,
    { batchId, reason: "values", orders: [...sells, ...buys] },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "values_switch",
    { type: "brokerage_batch", id: batchId },
    { switches: plan.switches.length, simulated: partner.simulated },
  );
  await track(userId, "values_switch", { switches: plan.switches.length });
  const items = await scopedFor(userId, client).accounts.findMany({
    where: {
      id: { in: [...new Set(plan.switches.map((s) => s.accountId))] },
      itemId: { not: null },
    },
    select: { itemId: true },
    distinct: ["itemId"],
  });
  for (const { itemId } of items) {
    if (itemId) await syncDemoInvestments(itemId, { client, now });
  }
  return { switches: plan.switches.length, plan };
}
