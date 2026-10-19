import { POLICY_KINDS, isPolicyKind } from "@/config/insurance";
import { confirmFoundPolicy, dismissFoundPolicy } from "@/lib/found-policies";
import { PolicyError } from "@/lib/insurance/policies";
import {
  ChatActionError,
  answeredElsewhere,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// Buttons on a policy found from payments (spec step 99), through the profile's own code:
// Confirm makes it cover on /insurance; Not insurance takes it off for good.

function policyOf({ message }: ActionContext) {
  const id = message.refs.policyId;
  if (!id) throw new ChatActionError("failed", "Something went wrong. Open it instead.");
  return id;
}

export const policyConfirm: ActionHandler = {
  id: "policy.confirm",
  on: "open",
  async run(context) {
    try {
      const { kind, carrier } = await confirmFoundPolicy(context.userId, policyOf(context), {
        client: context.client,
      });
      const what = isPolicyKind(kind) && kind !== "other" ? POLICY_KINDS[kind].toLowerCase() : "";
      return {
        answeredWith: context.action.label,
        note: `Confirmed. Your ${carrier} ${what ? `${what} ` : ""}insurance is on your profile. Add its deductible and limits on Insurance so I can check the cover.`,
      };
    } catch (error) {
      if (error instanceof PolicyError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const policyNotInsurance: ActionHandler = {
  id: "policy.not_insurance",
  on: "open",
  async run(context) {
    try {
      await dismissFoundPolicy(context.userId, policyOf(context), { client: context.client });
    } catch (error) {
      if (error instanceof PolicyError) throw answeredElsewhere(error.message);
      throw error;
    }
    return { answeredWith: context.action.label, note: "OK, my mistake. I've taken it off." };
  },
};
