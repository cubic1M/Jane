import { PRACTICE_TOPIC } from "@/config/practice-suggestions";
import { areaOfCapability } from "@/config/areas";
import { SIMULATED_PARTNER } from "@/config/brokerage";
import { investingTree } from "@/lib/area-pages/investing";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { loadReturns } from "@/lib/investments/returns";
import { backtestsFor } from "@/lib/investments/backtest";
import { practiceIdeasView } from "@/lib/practice/ideas-view";
import { autopilotOf } from "@/lib/autopilot";
import { investmentsByHerself } from "@/lib/jane-agent/investments/replies";
import { autopilotFor } from "@/lib/sector-autopilot";
import { scopedFor } from "@/lib/db-scoped";
import { loadInvestments } from "@/lib/investments/holdings";
import { profileOf } from "@/lib/investments/profile";
import { profileSummary } from "@/planning/investor-profile";

const PRACTICE_TOPICS: readonly string[] = Object.values(PRACTICE_TOPIC);

// Everything the Investing tree is built from (docs/design/area-pages.md), loaded once for the
// page and for the home tree, so both show the same statuses.
export async function loadInvestingArea(userId: string) {
  const db = scopedFor(userId);
  const data = await loadInvestments(userId);
  const [answers, simulated, level, investing, returns, crypto, backtests, suggestions] =
    await Promise.all([
      profileOf(userId),
      // Spec step 133: holdings shaped by simulated orders say so.
      db.brokerageOrders.count({ where: { partner: SIMULATED_PARTNER } }),
      // Spec step 137: what Jane does on its own at the person's autopilot level.
      autopilotOf(userId),
      // Spec step 141: what the Investing area may do by itself.
      autopilotFor(userId, "investing"),
      // Spec step 156: how they've done.
      loadReturns(userId, { investments: data }),
      // Spec step 161: crypto, read-only, counted in the mix.
      cryptoTotal(userId),
      // Spec step 295: each risk level replayed over past prices (demo advice only).
      backtestsFor(userId),
      // Jane's open ideas on real money in this area (practice ideas are the practice branch's).
      db.suggestions.findMany({
        where: { status: { in: ["waiting", "selected"] } },
        select: {
          key: true,
          capability: true,
          topic: true,
          short: true,
          why: true,
          worthCents: true,
          worthKind: true,
          urgency: true,
          actionLabel: true,
          actionHref: true,
        },
        orderBy: { score: "desc" },
      }),
    ]);
  // The practice portfolio and its ideas: demo advice only.
  const started = backtests.advice
    ? !!(await db.practicePortfolios.findFirst({ select: { id: true } }))
    : false;
  const ideas = started ? await practiceIdeasView(userId) : null;
  const mine = suggestions.filter(
    (s) => areaOfCapability(s.capability) === "investments" && !PRACTICE_TOPICS.includes(s.topic),
  );
  const byHerself = investmentsByHerself(level, investing);
  const profile = profileSummary(answers, data.asOf);
  const max = Math.max(1, ...data.months.map((m) => m.totalCents ?? 0));
  const hasMonths = data.months.some((m) => m.totalCents !== null);

  const area = investingTree({
    suggestions: mine,
    accounts: data.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      balanceCents: a.balanceCents,
      holdings: a.holdings.length,
    })),
    totalCents: data.totalCents,
    byType: data.byAssetClass.length,
    cryptoCents: crypto,
    profile: { complete: profile.complete, label: profile.complete ? profile.label : null },
    returns: { periods: returns.periods.length },
    months: data.accounts.length > 0,
    practice: backtests.advice
      ? {
          started,
          ideas: (ideas?.ideas ?? []).map((i) => ({
            key: i.suggestionKey,
            kind: i.kind,
            headline: i.headline,
            percent: i.confidence.percent,
            worthCents: i.worthCents,
          })),
          strategy: ideas?.strategy ?? null,
        }
      : null,
  });
  return {
    data,
    simulated,
    investing,
    returns,
    crypto,
    backtests,
    ideas,
    mine,
    byHerself,
    profile,
    max,
    hasMonths,
    area,
  };
}
