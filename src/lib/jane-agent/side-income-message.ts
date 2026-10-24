import { formatCents } from "@/lib/money";
import type { SideIncomeView } from "@/lib/side-income";
import { roundDollars } from "@/planning/tax-estimate-copy";
import type { MessageAction, MessageRefs } from "./types";

// Side income and rentals in the chat (spec step 173): a rental that needs its property
// for depreciation, hobby or business (both taxes shown, demo advice), and the answer to
// "my rental income" and "my gig income".

export const SIDE_HREF = "/taxes?focus=life:side-income";
export const SIDE_FORM_HREF = "/taxes/profile#side-income";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const STATUS: Record<string, string> = {
  matched: "matches its 1099",
  differs: "doesn't match its 1099 (I haven't used the form)",
  waiting: "waiting for its 1099",
  unneeded: "under the amount that gets a 1099",
};

export function rentalSetupMessage(view: SideIncomeView): Message | null {
  const r = view.rental;
  if (!r || r.rentCents <= 0 || r.priceCents) return null;
  return {
    body: `You've had ${formatCents(r.rentCents)} of rent in ${view.year}. The building can be written off over 27.5 years (depreciation), which lowers the tax on it. Tell me the price you paid and when it was ready to rent, and tag what you spend on it as rental expenses.`,
    refs: { taxYear: view.year },
    actions: [{ id: "open", label: "Add my rental", kind: "link", href: SIDE_FORM_HREF }],
  };
}

export function hobbyMessage(view: SideIncomeView): Message | null {
  if (view.kind || !view.bothWays || view.gigCents <= 0) return null;
  const { business, hobby } = view.bothWays;
  const less = business <= hobby ? "a business" : "a hobby";
  return {
    body: `Your gig and freelance income of ${formatCents(view.gigCents)} is taxed differently as a business (profit after expenses, plus self-employment tax) or a hobby (all of it, no expenses, no self-employment tax): federal tax about ${roundDollars(business)} as a business, ${roundDollars(hobby)} as a hobby. It's ${less} that costs less, but what it is depends on how you run it: regular time, a plan to make money, records, and profit in 3 of 5 years point to a business. Which is it?`,
    refs: { advice: true, taxYear: view.year },
    actions: [
      { id: "tax.side_business", label: "It's a business", kind: "primary" },
      { id: "tax.side_hobby", label: "It's a hobby", kind: "secondary" },
      { id: "open", label: "See my side income", kind: "link", href: SIDE_HREF },
    ],
  };
}

export function sideIncomeReply(view: SideIncomeView): Message {
  const lines: string[] = [];
  const r = view.rental;
  if (r) {
    lines.push(
      `Rental: ${formatCents(r.rentCents)} in, ${formatCents(r.expensesCents)} of tagged expenses${r.depreciation ? `, ${formatCents(r.depreciationCents)} of depreciation (27.5 years on ${formatCents(r.depreciation.buildingCents)} of building)` : ""}, so ${r.netCents < 0 ? `a loss of ${formatCents(-r.netCents)}` : `${formatCents(r.netCents)} of profit`}${r.suspendedCents > 0 ? `; only ${formatCents(-r.countedCents)} of the loss counts this year, ${formatCents(r.suspendedCents)} carries forward` : ""}.`,
    );
  }
  for (const p of view.platforms) {
    lines.push(`${p.payer}: ${formatCents(p.payoutsCents)} paid out, ${STATUS[p.status]}.`);
  }
  if (view.kind) lines.push(`You treat your gig and freelance income as a ${view.kind}.`);
  return {
    body:
      lines.length > 0
        ? `Your side income for ${view.year}:\n${lines.map((l) => `• ${l}`).join("\n")}\nIt's all in your estimate, your quarterly amounts and your tax-time pack.`
        : `I don't see rent or gig income in ${view.year}. If you have a rental, add it and tag its expenses.`,
    refs: {},
    actions: [{ id: "open", label: "See my side income", kind: "link", href: SIDE_HREF }],
  };
}
