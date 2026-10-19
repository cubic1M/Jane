import { demoAccounts, DEMO_INSTITUTION } from "@/data-sources/demo/demo-bank";
import { demoHoldings, demoSecurities } from "@/data-sources/demo/demo-holdings";
import { normalizeHolding, normalizeSecurity } from "@/data-sources/plaid/investments";
import { investmentSummary } from "@/insights/investments";
import type { Investments } from "@/lib/investments/holdings";

// For tests: the demo bank's investments as loadInvestments would return them, built with
// the same normalizers and summary as a real sync, without a database.

export const DEMO_FIXTURE_SEED = { seed: "fixture", anchor: "2026-10-18" };

export function demoInvestments(asOf = "2026-10-19"): Investments {
  const accounts = demoAccounts(DEMO_FIXTURE_SEED)
    .filter((a) => a.type === "investment")
    .map((a) => ({
      id: a.account_id,
      name: a.name,
      subtype: a.subtype ?? null,
      balanceCents: Math.round((a.balances.current ?? 0) * 100),
      institution: DEMO_INSTITUTION,
    }));
  const securities = demoSecurities("2026-10-18").map((s) => {
    const n = normalizeSecurity(s);
    return {
      id: n.ref,
      name: n.name,
      ticker: n.ticker,
      type: n.type,
      isCashEquivalent: n.isCashEquivalent,
    };
  });
  const holdings = demoHoldings(DEMO_FIXTURE_SEED, "2026-10-18").flatMap((h, i) => {
    const n = normalizeHolding(h);
    return n ? [{ id: `h${i}`, accountId: n.accountRef, securityId: n.securityRef, ...n }] : [];
  });
  return {
    asOf,
    ...investmentSummary(accounts, securities, holdings),
    months: [],
  };
}

export function noInvestments(asOf = "2026-10-19"): Investments {
  return { asOf, ...investmentSummary([], [], []), months: [] };
}
