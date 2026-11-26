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
import { loadDisasterRelief } from "@/lib/disasters";
import { MultiYearError, loadMultiYear, setRetireYear } from "@/lib/multi-year";
import { ProfileError, correctFact } from "@/lib/profile";
import { disasterReply } from "../disaster-message";
import { yearsReply } from "../multi-year-message";
import { snoozeButton } from "../sources/source";
import {
  FILING_BUTTONS,
  KIDS_BUTTONS,
  PROFILE_DONE,
  PROFILE_HREF,
  nextQuestion,
} from "../tax-flow";
import { type ActionId, openLink } from "../types";
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
    actions: [openLink("See my tax profile", PROFILE_HREF)],
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
    const view = await confirmFound(userId, field, {
      client,
      now,
      via: "chat",
      expected: context.message.refs.taxFound,
    }).catch(failed);
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

// "Yes, put it on" for a county the person typed ("I live in Travis County"): saved on the yes,
// then the disaster relief for it, in the same message (open O27).
export const taxCountySet: ActionHandler = {
  id: "tax.county_set",
  on: "open",
  async run({ userId, message, client, now, action }) {
    const county = message.refs.taxCounty;
    if (!county) throw new ChatActionError("failed", "Something went wrong. Say the county again.");
    try {
      await correctFact(userId, "county", county, { client, now });
    } catch (error) {
      if (error instanceof ProfileError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    const reply = disasterReply(await loadDisasterRelief(userId, { client, now }));
    return {
      // Open while the answer has buttons of its own (the disaster move): they work on an open one.
      status: reply.actions.some((a) => a.kind !== "link") ? "open" : "answered",
      answeredWith: action.label,
      body: `Got it: ${county} County.\n${reply.body}`,
      actions: reply.actions,
      refs: reply.refs,
      note: "Saved on your tax profile.",
    };
  },
};

// "Yes, put it on" for a retirement year the person typed ("I plan to retire in 2045").
export const taxRetireSet: ActionHandler = {
  id: "tax.retire_set",
  on: "open",
  async run({ userId, message, client, now, action }) {
    const year = message.refs.retireYear;
    if (typeof year !== "number") {
      throw new ChatActionError("failed", "Something went wrong. Say the year again.");
    }
    try {
      await setRetireYear(userId, year, { client, now, via: "chat" });
    } catch (error) {
      if (error instanceof MultiYearError) throw new ChatActionError("failed", error.message);
      throw error;
    }
    const reply = yearsReply(await loadMultiYear(userId, { client, now }));
    return {
      status: reply.actions.some((a) => a.kind !== "link") ? "open" : "answered",
      answeredWith: action.label,
      body: `Got it: you plan to retire in ${year}. ${reply.body}`,
      actions: reply.actions,
      refs: reply.refs,
      note: "Saved on your tax profile.",
    };
  },
};
