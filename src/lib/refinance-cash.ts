import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { loadFit } from "@/lib/fit";
import type { Refinance } from "@/lib/refinance";

// Refinance offers against paying off with cash (loans QA): a card the person's spare cash
// clears for less than any loan isn't refinanced. The fit engine (src/planning/fit.ts) decides,
// as it does for the options card and "should I consolidate?", so the refinance answer, its
// page and Claude's tool never pick a loan the fit engine would not. Only cards and personal
// loans are asked about: a mortgage, a car or a student loan is never paid off from cash here.

type Options = { client?: PrismaClient; now?: Date };

export async function withCashPayoffs(
  userId: string,
  refi: Refinance,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Refinance> {
  if (!refi.available) return refi;
  const comparisons = [];
  for (const c of refi.comparisons) {
    if (c.product !== "personal" || !c.pick) {
      comparisons.push(c);
      continue;
    }
    const fit = await loadFit(userId, { need: "refinance", debtKey: c.debtKey }, { client, now });
    const payoff = fit.pick === "payoff" ? fit.options.find((o) => o.id === "payoff") : null;
    comparisons.push(payoff ? { ...c, pick: null, cashPayoffCents: payoff.savesCents ?? 0 } : c);
  }
  return { ...refi, comparisons };
}
