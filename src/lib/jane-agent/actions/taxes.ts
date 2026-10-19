import { FILING_STATUSES, type FilingStatus } from "@/config/tax";
import {
  TaxProfileError,
  addIncomeKind,
  confirmFound,
  loadTaxProfile,
  saveTaxAnswers,
  type TaxAnswer,
} from "@/lib/tax-profile";
import type { TaxProfileView } from "@/planning/tax-profile";
import { snoozeButton } from "../sources/source";
import {
  FILING_BUTTONS,
  KIDS_BUTTONS,
  PROFILE_DONE,
  PROFILE_HREF,
  nextQuestion,
} from "../tax-flow";
import type { ActionId } from "../types";
import {
  ChatActionError,
  type ActionContext,
  type ActionHandler,
  type ActionOutcome,
} from "./handler";

// The tax profile from the chat (spec step 118), through its own code (src/lib/tax-profile.ts):
// each button saves one answer, then the same message asks the next question, until the
// profile is done. "Add it" and "Leave it off" answer a new kind of income Jane saw.

const failed = (error: unknown): never => {
  if (error instanceof TaxProfileError) throw new ChatActionError("failed", error.message);
  throw error;
};

// The next question in the same message, or the profile done.
function moveOn(context: ActionContext, view: TaxProfileView, note: string): ActionOutcome {
  const question = nextQuestion(view);
  if (question) {
    return {
      status: "open",
      body: question.body,
      actions: [...question.actions, snoozeButton()],
      refs: question.refs,
      answeredWith: null,
      note,
    };
  }
  return {
    answeredWith: context.action.label,
    note: PROFILE_DONE(view),
    actions: [{ id: "open", label: "See my tax profile", kind: "link", href: PROFILE_HREF }],
  };
}

async function answer(context: ActionContext, answer: TaxAnswer, note: string) {
  const { userId, client, now } = context;
  await saveTaxAnswers(userId, [answer], { client, via: "chat" }).catch(failed);
  return moveOn(context, await loadTaxProfile(userId, { client, now }), note);
}

export const taxFoundYes: ActionHandler = {
  id: "tax.found_yes",
  on: "open",
  async run(context) {
    const field = context.message.refs.taxField;
    if (field !== "incomeKinds" && field !== "state") {
      throw new ChatActionError("failed", "Something went wrong. Open your tax profile instead.");
    }
    const { userId, client, now } = context;
    const view = await confirmFound(userId, field, { client, now, via: "chat" }).catch(failed);
    return moveOn(context, view, field === "state" ? "Got it." : "Got it. That's your income.");
  },
};

const filing = (id: ActionId, status: FilingStatus): ActionHandler => ({
  id,
  on: "open",
  run: (context) =>
    answer(
      context,
      { field: "filingStatus", value: status },
      `Got it: ${FILING_STATUSES[status]}.`,
    ),
});

const kids = (id: ActionId, n: number): ActionHandler => ({
  id,
  on: "open",
  async run(context) {
    const { userId, client, now } = context;
    // Other dependants stay as they were (set on the profile page).
    const current = await loadTaxProfile(userId, { client, now });
    return answer(
      context,
      {
        field: "dependants",
        childrenUnder17: n,
        otherDependants: current.dependants.otherDependants ?? 0,
      },
      n === 0 ? "Got it: no children under 17." : `Got it: ${n} under 17.`,
    );
  },
});

export const TAX_PROFILE_HANDLERS = Object.fromEntries([
  ...(Object.entries(FILING_BUTTONS) as [FilingStatus, ActionId][]).map(([status, id]) => [
    id,
    filing(id, status),
  ]),
  ...KIDS_BUTTONS.map((id, n) => [id, kids(id, n)]),
]) as Record<
  | "tax.filing_single"
  | "tax.filing_joint"
  | "tax.filing_separate"
  | "tax.filing_head"
  | "tax.kids_0"
  | "tax.kids_1"
  | "tax.kids_2"
  | "tax.kids_3",
  ActionHandler
>;

export const taxIncomeAdd: ActionHandler = {
  id: "tax.income_add",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const kind = message.refs.incomeKind ?? "";
    await addIncomeKind(userId, kind, { client, now, via: "chat" }).catch(failed);
    return { answeredWith: action.label, note: "Added to your tax profile." };
  },
};

export const taxIncomeNo: ActionHandler = {
  id: "tax.income_no",
  on: "open",
  async run({ action }) {
    return {
      answeredWith: action.label,
      note: "OK, I've left it off. You can add it on your tax profile any time.",
    };
  },
};

// "Yes, put it on" for a state the person typed ("I live in Texas").
export const taxStateSet: ActionHandler = {
  id: "tax.state_set",
  on: "open",
  run: (context) =>
    answer(context, { field: "state", value: context.message.refs.taxState ?? "" }, "Got it."),
};
