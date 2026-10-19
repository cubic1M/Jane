import type { TaxSaving } from "@/planning/tax-savings";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { snoozeButton } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// A way to pay less (spec step 122), as Jane says it in the chat: what, why, about how much
// (an estimate), and the one button that does it. Demo advice, labelled.

export function savingMessage(
  saving: TaxSaving,
  year: number,
): { body: string; actions: MessageAction[]; refs: MessageRefs } {
  const action = saving.action;
  const refs: MessageRefs = { advice: true, taxSaving: saving.key, taxYear: year };
  const buttons: MessageAction[] = [];
  if (action.kind === "task") {
    buttons.push({ id: "tax.save_task", label: "Remind me", kind: "primary" });
    refs.taxTask = { title: action.title, dueOn: action.dueOn, note: action.note };
  } else if (action.kind === "goal") {
    buttons.push({ id: "goal.start", label: "Start a goal for it", kind: "primary" });
    refs.goal = {
      name: action.name,
      targetCents: action.targetCents,
      targetDate: action.targetDate,
    };
  } else {
    buttons.push({ id: "open", label: action.label, kind: "link", href: action.href });
  }
  buttons.push({ id: "tax.save_no", label: "Not for me", kind: "secondary" }, snoozeButton());
  return {
    body: `${saving.title}. ${saving.why} By my estimate that's about ${roundDollars(saving.estimateCents)} less tax for ${year}.`,
    actions: buttons,
    refs,
  };
}
