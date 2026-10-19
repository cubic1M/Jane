import type { TaxFormKey } from "@/config/tax";
import type { CollectedForm, TaxDocumentsView } from "@/lib/tax-documents";
import { formatCents } from "@/lib/money";
import { COMPARED } from "@/planning/tax-document-check";
import { listOf } from "@/planning/tax-profile";
import { shortDate } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// Tax forms that collect themselves, in the chat (spec step 166): a form that doesn't match
// the accounts (flagged, not used), the forms collected (ticked off by Jane at the levels
// that let her act, one tap otherwise), a form still missing, and the answer to "my tax
// forms".

export const FORMS_HREF = "/taxes#forms";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

const formName = (f: CollectedForm) => `${f.form} from ${f.from}`;

export function flaggedMessage(f: CollectedForm, year: number): Message {
  const check = f.check!;
  const what = COMPARED[f.formKey as TaxFormKey];
  const why =
    f.formKey === "w2"
      ? " A deduction taken after tax, like a Roth 401(k), can explain it; otherwise ask them for a corrected form."
      : " Ask them for a corrected form if it's wrong.";
  return {
    body: `Your ${formName(f)} for ${year} doesn't match your accounts: it shows ${what} of ${formatCents(check.formCents)}, and your accounts show ${formatCents(check.seenCents ?? 0)} (${formatCents(Math.abs(check.diffCents))} apart). I haven't used it.${why}`,
    refs: { taxForm: f.key, taxYear: year },
    actions: [
      { id: "tax.doc_right", label: "It's right, use it", kind: "primary" },
      { id: "tax.doc_ask", label: "Remind me to ask them", kind: "secondary" },
      { id: "open", label: "See tax forms", kind: "link", href: FORMS_HREF },
    ],
  };
}

// The forms collected that check out. At the levels that let Jane act they're already
// ticked off; otherwise one tap does it.
export function collectedMessage(view: TaxDocumentsView, acts: boolean): Message | null {
  const good = view.forms.filter((f) => f.document && f.usable);
  if (good.length === 0) return null;
  const waiting = good.filter((f) => !f.received);
  const n = good.length;
  const list = listOf(good.map(formName));
  const checked = good.every((f) => f.check?.status === "matches")
    ? "They match your accounts."
    : "The ones I could check match your accounts.";
  if (acts || waiting.length === 0) {
    return {
      body: `I collected ${n} tax ${n === 1 ? "form" : "forms"} for ${view.year}: ${list}. ${checked} I've ticked ${n === 1 ? "it" : "them"} off.`,
      refs: { taxYear: view.year },
      actions: [{ id: "open", label: "See tax forms", kind: "link", href: FORMS_HREF }],
    };
  }
  return {
    body: `I collected ${n} tax ${n === 1 ? "form" : "forms"} for ${view.year}: ${list}. ${checked} Tick ${n === 1 ? "it" : "them"} off?`,
    refs: { taxYear: view.year },
    actions: [
      { id: "tax.docs_tick", label: "Tick them off", kind: "primary" },
      { id: "open", label: "See tax forms", kind: "link", href: FORMS_HREF },
    ],
  };
}

export function missingMessage(f: CollectedForm, year: number): Message {
  return {
    body: `Your ${formName(f)} for ${year} hasn't come through yet: it was due by ${shortDate(f.by)}. I'll keep looking every day. Want a reminder to ask them?`,
    refs: { taxForm: f.key, taxYear: year },
    actions: [
      { id: "tax.doc_chase", label: "Remind me", kind: "primary" },
      { id: "tax.form_got", label: "I have it", kind: "secondary" },
      { id: "open", label: "See tax forms", kind: "link", href: FORMS_HREF },
    ],
  };
}

// "My tax forms": each expected form, collected (and how it checked), ticked off, or due.
export function documentsReply(view: TaxDocumentsView): Message {
  if (view.forms.length === 0) {
    return {
      body: `I don't expect any tax forms for ${view.year} from what's in your accounts. If you were paid somewhere I can't see, that payer sends its own.`,
      refs: {},
      actions: [{ id: "open", label: "See your taxes", kind: "link", href: FORMS_HREF }],
    };
  }
  const line = (f: CollectedForm) => {
    if (f.document) {
      const status =
        f.check?.status === "differs" && f.document.decision !== "right"
          ? "collected, doesn't match your accounts (not used)"
          : f.check?.status === "unchecked"
            ? "collected (nothing in your accounts to check it against)"
            : "collected, matches your accounts";
      return `- ${formName(f)}: ${status}`;
    }
    if (f.received) return `- ${formName(f)}: you have it`;
    if (f.mayNotSend) return `- ${formName(f)}: may not send one (below the reporting threshold)`;
    return `- ${formName(f)}: usually ready by ${shortDate(f.by)}${view.collecting ? ", I'll collect it" : ""}`;
  };
  return {
    body: `Your tax forms for ${view.year}:\n${view.forms.map(line).join("\n")}`,
    refs: {},
    actions: [{ id: "open", label: "See tax forms", kind: "link", href: FORMS_HREF }],
  };
}
