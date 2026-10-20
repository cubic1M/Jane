import type { EquityTaxView } from "@/lib/equity-tax";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";

// Crypto and equity pay in the chat (spec step 219): what these add to the tax and what to
// set aside, with its button (demo advice), and the answer to "my crypto taxes", "ESPP",
// "AMT", "RSU withholding".

export const EQUITY_HREF = "/taxes/equity";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function equitySetAsideMessage(view: EquityTaxView): Message {
  const lines = view.setAside.parts
    .map((p) => `• ${p.label}: about ${roundDollars(p.cents)}`)
    .join("\n");
  return {
    body: `Your crypto and equity pay will add to your ${view.year} tax, and none of it comes out of your paycheck by itself. Estimated:\n${lines}\nAbout ${roundDollars(view.setAside.cents)} to set aside. Want a goal for it? Putting the money in is yours.`,
    refs: { advice: true, taxYear: view.year },
    actions: [
      {
        id: "tax.equity_aside",
        label: `Start a goal for ${roundDollars(view.setAside.cents)}`,
        kind: "primary",
      },
      { id: "open", label: "See the details", kind: "link", href: EQUITY_HREF },
    ],
  };
}

export function equityReply(view: EquityTaxView): Message {
  const lines: string[] = [];
  const c = view.cryptoYear;
  if (view.income.crypto.yearSales.length > 0) {
    lines.push(
      `Crypto sold in ${view.year}: ${formatCents(c.proceedsCents)} in, ${formatCents(c.costCents)} cost by lot, a ${c.shortTermCents + c.longTermCents < 0 ? "loss" : "gain"} of ${formatCents(Math.abs(c.shortTermCents + c.longTermCents))} (${formatCents(c.shortTermCents)} short-term, ${formatCents(c.longTermCents)} long-term).`,
    );
  }
  const held = view.income.crypto.holdings;
  if (held.length > 0) {
    lines.push(
      `Crypto you hold is up ${formatCents(view.unrealisedCryptoCents.gain)} before any sale (${formatCents(view.unrealisedCryptoCents.longTerm)} of it long-term).`,
    );
  }
  for (const f of view.forms1099DA) {
    lines.push(
      `1099-DA from ${f.exchange}: ${f.status === "waiting" ? "waiting for it" : f.status === "differs" ? "doesn't match your sales (not used)" : "collected"}.`,
    );
  }
  for (const e of view.income.events) {
    if (e.espp && e.event.soldOn?.startsWith(String(view.year))) {
      lines.push(
        `ESPP sale of ${e.event.shares} ${e.event.company} shares: ${e.espp.qualifying ? "a qualifying sale, so most of the gain is long-term" : `a disqualifying sale (inside 2 years of the offering or 1 of the purchase), so ${formatCents(e.espp.ordinaryCents)} is ordinary income${e.espp.lostTreatmentCents > 0 ? `, ${formatCents(e.espp.lostTreatmentCents)} more than a qualifying sale` : ""}`}.`,
      );
    }
    if (e.iso && e.iso.preferenceCents > 0) {
      lines.push(
        `ISOs exercised (${e.event.shares} ${e.event.company} shares): ${formatCents(e.iso.preferenceCents)} counts toward the alternative minimum tax${view.amtCents > 0 ? `, about ${formatCents(view.amtCents)} of AMT` : ", not enough to owe any"}.`,
      );
    }
  }
  for (const r of view.rsu) {
    lines.push(
      `RSUs vested at ${r.company}: ${formatCents(r.incomeCents)} of income, ${formatCents(r.withheldCents)} withheld (${Math.round(r.rateWithheld * 100)}%)${r.shortfallCents > 0 ? `, which falls ${formatCents(r.shortfallCents)} short at your real rate` : ", which covers it"}.`,
    );
  }
  const advice = lines.length > 0 && view.setAside.cents > 0 && view.advice;
  return {
    body:
      lines.length > 0
        ? `Here's how your crypto and equity pay is taxed for ${view.year}.\n${lines.map((l) => `• ${l}`).join("\n")}${advice ? `\nAbout ${roundDollars(view.setAside.cents)} to set aside for the tax these add.` : ""}`
        : "I don't see crypto sales or equity pay for this year. Add RSUs vested, ESPP shares sold or ISOs exercised and I'll work out the tax; connect an exchange and I'll work out the gains by lot.",
    refs: advice ? { advice: true } : {},
    actions: [
      ...(advice && !view.setAside.goalStarted && view.setAside.cents >= EQUITY_MIN
        ? [
            {
              id: "tax.equity_aside",
              label: `Start a goal for ${roundDollars(view.setAside.cents)}`,
              kind: "primary",
            } as MessageAction,
          ]
        : []),
      { id: "open", label: "See my crypto and equity", kind: "link", href: EQUITY_HREF },
    ],
  };
}

const EQUITY_MIN = 20_000;
