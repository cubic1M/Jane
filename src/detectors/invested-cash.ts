import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, headlineOf, weakest } from "./helpers";

// Cash sitting inside investment accounts (spec: the investing leak): the "Cash & Cash
// Investments" a brokerage holds beside the funds, which earns little while it waits. Checking
// and savings are the idle-cash detector's; this one reads only what is held in a brokerage or
// retirement account (not an HSA, which has its own) and not a money market fund, which pays its
// way. Pure; see ./contract.ts.

const SKIP_SUBTYPES = new Set(["hsa"]);

const investedCash: Detector = {
  capability: "investing",
  topic: "invested_cash",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    const inAccounts = new Map(data.accounts.map((a) => [a.id, a]));
    const idle = (data.holdings ?? []).filter((h) => {
      const account = inAccounts.get(h.accountId);
      return (
        h.isCash &&
        h.ticker === null &&
        h.valueCents > 0 &&
        account?.type === "investment" &&
        !SKIP_SUBTYPES.has(account.subtype ?? "")
      );
    });
    const total = idle.reduce((s, h) => s + h.valueCents, 0);
    const excess = total - R.investedCashBufferCents;
    if (excess < R.investedCashMinCents) return null;
    const earns = Math.round((excess * (R.highYieldBps - R.currentCashBps)) / 10_000);
    return {
      id: suggestionId("investing", "invested_cash"),
      capability: "investing",
      topic: "invested_cash",
      title: "Put the cash waiting in your investment accounts to work",
      headline: headlineOf("Put your waiting cash to work", earns, "earns"),
      short: `${formatCents(total)} is cash inside your investment accounts.`,
      worthCents: earns,
      worthKind: "earns",
      confidence: weakest([
        evidence("seen", profile.months, idle.length, "cash balances in investment accounts"),
        { percent: 75, reason: "what your broker pays on this cash isn't known" },
      ]),
      urgency: "later",
      why: `${formatCents(total)} sits as cash inside your investment accounts. After keeping ${formatCents(R.investedCashBufferCents)} for trades, ${formatCents(excess)} could earn about ${formatCents(earns)} more a year in a money market fund or Treasury bills than most brokers pay on a sweep.`,
      action: { label: "See where it sits", href: "/investments" },
      watch: { kind: "cash_invested", beforeCents: total, excessCents: excess, yearlyCents: earns },
    };
  },
};

export const INVESTED_CASH_DETECTORS: readonly Detector[] = [investedCash];
