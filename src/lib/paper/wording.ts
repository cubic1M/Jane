import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { SIMULATED_LABEL } from "@/config/paper";
import { checkGuardrails } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";

// What the trade pop-up says (CLAUDE.md's advice rule). In advice mode (the demo bank, trial
// people): Jane's recommendation in full, with DEMO_ADVICE_LABEL, checked with the "demo_advice"
// profile. A real account: only its own chosen strategy's rule firing on its simulated account,
// "Your strategy's rule: …", labelled SIMULATED_LABEL, checked with the standard profile; a news
// idea is Jane recommending, so a real account never sees one. Text that fails its check is never
// shown (null).

export type SignalFacts = {
  source: string;
  ticker: string;
  side: string;
  amountCents: number;
  reason: string;
  confidence: number;
};

export type SignalCard = {
  headline: string;
  reason: string;
  // How sure Jane is, in advice mode only.
  confidence: number | null;
  label: string;
};

const dollars = (cents: number) => formatCents(cents).replace(/\.00$/, "");

export function signalCard(s: SignalFacts, { advice }: { advice: boolean }): SignalCard | null {
  const verb = s.side === "sell" ? "Sell" : "Buy";
  if (advice) {
    const card = {
      headline: `${verb} ${dollars(s.amountCents)} of ${s.ticker}`,
      reason: s.reason,
      confidence: s.confidence,
      label: DEMO_ADVICE_LABEL,
    };
    const text = `${card.headline}. ${card.reason}`;
    return checkGuardrails(text, [s.amountCents], undefined, "demo_advice").ok ? card : null;
  }
  if (s.source !== "rule") return null;
  const card = {
    headline: `Your strategy's rule: ${verb.toLowerCase()} ${dollars(s.amountCents)} of ${s.ticker}`,
    reason: `On your simulated account. ${s.reason}`,
    confidence: null,
    label: SIMULATED_LABEL,
  };
  const text = `${card.headline}. ${card.reason}`;
  return checkGuardrails(text, [s.amountCents]).ok ? card : null;
}
