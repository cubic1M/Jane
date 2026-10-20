import {
  PropertyTaxError,
  chooseFiler,
  draftPropertyAppeal,
  markClaimed,
  remindAppealWindow,
  remindExemption,
} from "@/lib/property-tax";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { ChatActionError, type ActionContext, type ActionHandler } from "./handler";

// Property tax from the chat (spec step 221): draft an appeal, say who files it, set the
// deadline, and handle an exemption. Each is the person's tap; Jane files and applies for
// nothing herself.

const failed = (error: unknown): never => {
  if (error instanceof PropertyTaxError) throw new ChatActionError("failed", error.message);
  throw error;
};
const keyOf = ({ message }: ActionContext) => {
  const key = message.refs.propertyExemption;
  if (!key) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
  return key;
};

export const taxPropertyDraft: ActionHandler = {
  id: "tax.property_draft",
  on: "open",
  async run({ userId, action, client, now }) {
    const a = await draftPropertyAppeal(userId, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: your appeal is drafted (about ${roundDollars(a.savingCents)} a year if it works) and the deadline is on your plan. Tell me who files it.`,
    };
  },
};

export const taxPropertyRemind: ActionHandler = {
  id: "tax.property_remind",
  on: "open",
  async run({ userId, action, client, now }) {
    const closes = await remindAppealWindow(userId, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: the appeal deadline, ${closes}, is on your plan.`,
    };
  },
};

const filer = (
  id: ActionHandler["id"],
  by: "team" | "you" | "drop",
  note: string,
): ActionHandler => ({
  id,
  on: "open",
  async run({ userId, action, client, now }) {
    await chooseFiler(userId, by, { client, now }).catch(failed);
    return { answeredWith: action.label, note };
  },
});

export const taxPropertyTeam = filer(
  "tax.property_team",
  "team",
  "Done: my team has your appeal to file. I'll tell you when it's in.",
);
export const taxPropertySelf = filer(
  "tax.property_self",
  "you",
  "Done: it's yours to file. The draft is on your property tax page, and the deadline is on your plan.",
);
export const taxPropertyDrop = filer("tax.property_drop", "drop", "Okay, I've dropped the appeal.");

export const taxExemptionRemind: ActionHandler = {
  id: "tax.exemption_remind",
  on: "open",
  async run(context) {
    const { userId, action, client, now } = context;
    const e = await remindExemption(userId, keyOf(context), { client, now }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: applying for the ${e.name} is on your deadlines.`,
    };
  },
};

export const taxExemptionClaimed: ActionHandler = {
  id: "tax.exemption_claimed",
  on: "open",
  async run(context) {
    const { userId, action, client, now } = context;
    await markClaimed(userId, [keyOf(context)], { client, now }).catch(failed);
    return { answeredWith: action.label, note: "Good, I won't bring that one up again." };
  },
};
