import { WASH_SALE_DAYS } from "@/config/tax-rates";
import type { InvestmentTaxesView } from "@/lib/investment-taxes";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import { formatCents } from "@/lib/money";
import type { HarvestChance, InvHolding, Realised } from "@/planning/investment-taxes";
import { estimateTaxes } from "@/planning/tax-estimate";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { snoozeButton } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// Investment taxes in the chat (spec step 124): wash-sale warnings for everyone, and (demo
// advice) losses worth harvesting and what's better held in a 401(k) or IRA.

export type Said = { body: string; actions: MessageAction[]; refs: MessageRefs };
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const label = (h: { ticker: string | null; name: string }) => h.ticker ?? h.name;

export function washSaleMessage(r: Realised): Said {
  const loss = -(r.gainCents - r.washDisallowedCents);
  const shares = Number(r.quantity.toFixed(3));
  return {
    body: `Your sale of ${shares} ${label(r)} on ${day(r.date)} was at a loss of ${formatCents(loss)}, but ${label(r)} was bought again within ${WASH_SALE_DAYS} days (${day(r.washReplacements[0].date)}), so ${formatCents(r.washDisallowedCents)} of the loss can't count this year: it's a wash sale. That part is added to the new shares' cost instead.`,
    actions: [
      { id: "open", label: "See investment taxes", kind: "link", href: "/taxes#investments" },
    ],
    refs: {},
  };
}

// About how much less tax selling it this year would mean, by the estimate.
export function harvestSaving(chance: HarvestChance, estimate: TaxEstimateView): number {
  const total = (e: ReturnType<typeof estimateTaxes>) => e.totalTaxCents + (e.state?.taxCents ?? 0);
  const input = estimate.input;
  const after = estimateTaxes({
    ...input,
    income: {
      ...input.income,
      shortTermGainsCents: input.income.shortTermGainsCents + chance.shortTermCents,
      longTermGainsCents: input.income.longTermGainsCents + chance.longTermCents,
    },
  });
  return total(estimate.estimate) - total(after);
}

export function harvestMessage(chance: HarvestChance, estimate: TaxEstimateView): Said {
  const saving = harvestSaving(chance, estimate);
  const gains =
    estimate.input.income.shortTermGainsCents + estimate.input.income.longTermGainsCents;
  const offset =
    gains > 0
      ? `offset ${roundDollars(gains)} of gains you've had this year`
      : "come off up to $3,000 of your other income";
  const wash = chance.washRisk.reinvests
    ? ` It reinvests its dividends, so turn that off first: buying it again within ${WASH_SALE_DAYS} days either side would make it a wash sale.`
    : chance.washRisk.boughtRecently
      ? ` You bought some in the last ${WASH_SALE_DAYS} days, so wait until that's ${WASH_SALE_DAYS} days past or it'd be a wash sale.`
      : ` Don't buy it back for ${WASH_SALE_DAYS} days, or it's a wash sale; a similar, not identical, fund keeps you invested.`;
  return {
    body: `${chance.holding.name} is down ${formatCents(chance.lossCents)}. Selling it before Dec 31 would let the loss ${offset}: about ${roundDollars(saving)} less tax, by my estimate.${wash}`,
    actions: [{ id: "tax.save_task", label: "Remind me", kind: "primary" }, snoozeButton()],
    refs: {
      advice: true,
      taxTask: {
        title: `Decide on selling ${label(chance.holding)} for its tax loss`,
        dueOn: `${estimate.year}-12-15`,
        note: chance.washRisk.reinvests
          ? "Turn off dividend reinvestment first."
          : `No buying it back for ${WASH_SALE_DAYS} days.`,
      },
    },
  };
}

export function locationMessage(h: InvHolding): Said {
  return {
    body: `${h.name} pays out income that's taxed every year in your brokerage account. Held in a 401(k) or IRA instead, it wouldn't be, so new money for it is better put there, and the brokerage kept for index funds that pay out little.`,
    actions: [
      { id: "open", label: "See your investments", kind: "link", href: "/investments" },
      snoozeButton(),
    ],
    refs: { advice: true },
  };
}

export function investmentsReply(
  view: InvestmentTaxesView,
  estimate: TaxEstimateView,
  advice: boolean,
): Said {
  if (view.taxableAccounts === 0) {
    return {
      body: "You don't have a taxable investment account linked, so there are no gains or losses to count: retirement accounts aren't taxed on them.",
      actions: [],
      refs: {},
    };
  }
  const r = view.realisedCents;
  const u = view.unrealisedCents;
  const realisedLine = `In ${view.year} so far you've realised ${formatCents(r.shortTerm + r.longTerm)} of gains (${formatCents(r.longTerm)} long-term, ${formatCents(r.shortTerm)} short-term), from the cost basis your broker reports.`;
  const open = ` Not yet sold: ${formatCents(u.total)} (${formatCents(u.longTerm)} long-term).`;
  const wash =
    view.washSales.length > 0
      ? ` One sale at a loss was a wash sale (${formatCents(view.washSales[0].washDisallowedCents)} can't count).`
      : "";
  const harvest =
    advice && view.harvest[0]
      ? ` ${view.harvest[0].holding.name} is down ${formatCents(view.harvest[0].lossCents)}: selling it this year would mean about ${roundDollars(harvestSaving(view.harvest[0], estimate))} less tax, by my estimate.`
      : "";
  return {
    body: `${realisedLine}${open}${wash}${harvest}`,
    actions: [
      { id: "open", label: "See investment taxes", kind: "link", href: "/taxes#investments" },
    ],
    refs: harvest ? { advice: true } : {},
  };
}
