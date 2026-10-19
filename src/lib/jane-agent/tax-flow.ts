import { FILING_STATUSES, INCOME_KINDS, TAX_YEAR, type FilingStatus } from "@/config/tax";
import {
  PROFILE_FIELDS,
  incomeLine,
  listOf,
  stateName,
  type ProfileField,
  type TaxProfileView,
} from "@/planning/tax-profile";
import type { ActionId, MessageAction, MessageRefs } from "./types";

// The tax profile in the chat (spec step 118): one question at a time, in one message.
// Each answer goes through the profile's own code (src/lib/tax-profile.ts) and the same
// message moves on to the next question, so the flow can be left and picked up later.
// Anything with too many answers for buttons (a state, other dependants) links to the
// profile page, and can be typed ("I live in Texas").

export const PROFILE_HREF = "/taxes/profile";
export const TAGS_HREF = "/taxes/tags";

const link = (label: string, href = PROFILE_HREF): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});
const button = (id: ActionId, label: string, primary = false): MessageAction => ({
  id,
  label,
  kind: primary ? "primary" : "secondary",
});

// The buttons for each filing status, and back.
export const FILING_BUTTONS: Readonly<Record<FilingStatus, ActionId>> = {
  single: "tax.filing_single",
  married_joint: "tax.filing_joint",
  married_separate: "tax.filing_separate",
  head_of_household: "tax.filing_head",
};
export const KIDS_BUTTONS: readonly ActionId[] = [
  "tax.kids_0",
  "tax.kids_1",
  "tax.kids_2",
  "tax.kids_3",
];

export type Question = { body: string; actions: MessageAction[]; refs: MessageRefs };

// Whether the chat can take the answer with a button: a filing status, a number of
// children, or a yes to what Jane found.
const askable = (view: TaxProfileView, field: ProfileField) =>
  view[field].status !== "yours" &&
  (field === "filingStatus" || field === "dependants" || view[field].status === "found");

// The next question the chat asks, or null when the profile is done.
export function nextQuestion(view: TaxProfileView): Question | null {
  if (view.complete) return null;
  const field = PROFILE_FIELDS.find((f) => askable(view, f));
  if (!field) {
    const missing = PROFILE_FIELDS.filter((f) => view[f].status !== "yours").map(
      (f) => FIELD_NAMES[f],
    );
    return {
      body: `Nearly done. I couldn't work out ${listOf(missing)} from your accounts, so tell me on your tax profile${view.state.status === "missing" ? ', or here ("I live in Texas")' : ""}.`,
      actions: [link("Finish my tax profile")],
      refs: { taxField: PROFILE_FIELDS.find((f) => view[f].status !== "yours") },
    };
  }
  return { ...question(view, field), refs: { taxField: field } };
}

export const FIELD_NAMES: Readonly<Record<ProfileField, string>> = {
  incomeKinds: "your kinds of income",
  filingStatus: "how you file",
  dependants: "your dependants",
  state: "your state",
};

function question(view: TaxProfileView, field: ProfileField): Omit<Question, "refs"> {
  switch (field) {
    case "incomeKinds":
      return {
        body: `From your accounts, your income for ${TAX_YEAR} looks like ${listOf(view.incomeKinds.found.map(incomeLine))}. Is that all of it?`,
        actions: [button("tax.found_yes", "That's all of it", true), link("Change it")],
      };
    case "filingStatus":
      return {
        body: `How will you file for ${TAX_YEAR}?`,
        actions: [
          ...(Object.keys(FILING_BUTTONS) as FilingStatus[]).map((s) =>
            button(FILING_BUTTONS[s], FILING_STATUSES[s]),
          ),
          link("Not sure"),
        ],
      };
    case "dependants":
      return {
        body: `How many children under 17 will you claim for ${TAX_YEAR}?${view.dependants.hint ? " I've seen childcare in your spending, so I'm asking rather than guessing." : ""}`,
        actions: [
          ...KIDS_BUTTONS.map((id, n) => button(id, n === 0 ? "None" : String(n))),
          link("More, or other dependants"),
        ],
      };
    case "state":
      return {
        body: `You live in ${stateName(view.state.value)}, going by ${view.state.from}. Is that the state you'll file in for ${TAX_YEAR}?`,
        actions: [button("tax.found_yes", "That's right", true), link("Change it")],
      };
  }
}

// The intro the first message starts with.
export const PROFILE_INTRO =
  "Let's get your taxes ready. I've worked out what I can from your accounts; I need a few answers for the rest, and you can change any of them later.";

// One line on the finished profile.
export function profileSummary(view: TaxProfileView): string {
  const parts: string[] = [];
  if (view.filingStatus.value) parts.push(FILING_STATUSES[view.filingStatus.value].toLowerCase());
  const kids = view.dependants.childrenUnder17 ?? 0;
  const others = view.dependants.otherDependants ?? 0;
  parts.push(
    kids === 0 ? "no children under 17" : `${kids} ${kids === 1 ? "child" : "children"} under 17`,
  );
  if (others > 0) parts.push(`${others} other ${others === 1 ? "dependant" : "dependants"}`);
  if (view.state.value) parts.push(`filing in ${stateName(view.state.value)}`);
  const kinds = view.incomeKinds.value.map((k) => INCOME_KINDS[k].seen);
  if (kinds.length > 0) parts.push(`income from ${listOf(kinds)}`);
  return parts.join(", ");
}

export const PROFILE_DONE = (view: TaxProfileView) =>
  `That's your tax profile done: ${profileSummary(view)}. I'll keep it up to date from your accounts and tell you if anything new turns up.`;
