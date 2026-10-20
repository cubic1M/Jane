import type { HomeTaxesView } from "@/lib/home-taxes";
import { formatCents } from "@/lib/money";
import { figuresOf, type Figure, type Source } from "@/planning/home-taxes";
import type { MessageAction, MessageRefs } from "./types";

// Homeowner taxes in the chat (spec step 170): the state and local tax cap when it bites,
// a home sale against the exclusion, and "my mortgage interest / property tax". Facts from
// the person's own accounts, each with where it came from.

export const HOME_HREF = "/taxes#home";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function sourceText(s: Source): string {
  switch (s.kind) {
    case "transaction":
      return `${s.payee}, ${s.date}, ${formatCents(s.cents)}`;
    case "loan":
      return `${s.name}, as your lender reports it`;
    case "document":
      return `your ${s.form} from ${s.from}`;
    case "answer":
      return s.label.charAt(0).toLowerCase() + s.label.slice(1);
  }
}

const figureLine = (f: Figure) =>
  `• ${f.label}: ${formatCents(f.cents)} (from ${f.sources.map(sourceText).join("; ")})${f.note ? `. ${f.note}` : ""}`;

export function saltCapMessage(view: HomeTaxesView): Message | null {
  const salt = view.salt;
  if (salt.overCents <= 0 || !salt.property) return null;
  return {
    body: `Your state and local taxes for ${view.year} come to ${formatCents(salt.totalCents)}: ${formatCents(salt.stateIncome.cents)} of income tax and ${formatCents(salt.property.cents)} of property tax. Only ${formatCents(salt.capCents)} counts if you itemize (the state and local tax cap), so ${formatCents(salt.overCents)} doesn't.`,
    refs: { taxYear: view.year },
    actions: [{ id: "open", label: "See your home's taxes", kind: "link", href: HOME_HREF }],
  };
}

export function homeSaleMessage(view: HomeTaxesView): Message | null {
  const s = view.sale;
  if (!s) return null;
  const outcome = s.qualifies
    ? s.taxableGainCents > 0
      ? `Up to ${formatCents(s.exclusionCents)} of the gain is tax-free, so about ${formatCents(s.taxableGainCents)} is taxed as a long-term gain.`
      : `It's all under the ${formatCents(s.exclusionCents)} you can exclude, so none of it is taxed.`
    : `It doesn't qualify for the exclusion (${s.why.join(" ")}), so the gain is taxed.`;
  return {
    body: `Your home sale: a gain of about ${formatCents(Math.max(0, s.gainCents))} (sold for ${formatCents(s.sale.cents)} after costs; it cost you ${formatCents(s.basis.cents)} with improvements). ${outcome} Keep the closing papers and improvement receipts.`,
    refs: { taxYear: view.year },
    actions: [{ id: "open", label: "See your home's taxes", kind: "link", href: HOME_HREF }],
  };
}

export function homeReply(view: HomeTaxesView): Message {
  const figures = figuresOf(view);
  if (!view.homeowner && figures.length <= 1) {
    return {
      body: `I don't see a mortgage, property tax or a home sale for ${view.year} in your accounts. If you have them somewhere I can't see, add them on your tax profile.`,
      refs: {},
      actions: [
        { id: "open", label: "Your tax profile", kind: "link", href: "/taxes/profile#home" },
      ],
    };
  }
  const salt = view.salt;
  const cap = `State and local taxes: ${formatCents(salt.totalCents)}, of which ${formatCents(salt.allowedCents)} counts under the ${formatCents(salt.capCents)} cap.`;
  const sale = view.sale ? `\n${homeSaleMessage(view)!.body}` : "";
  return {
    body: `Here is what your home changes on your ${view.year} taxes.\n${figures.map(figureLine).join("\n")}\n${cap}${sale}`,
    refs: {},
    actions: [{ id: "open", label: "See your home's taxes", kind: "link", href: HOME_HREF }],
  };
}
