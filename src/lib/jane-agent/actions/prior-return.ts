import { PriorReturnError, confirmPriorReturn, dismissPriorReturn } from "@/lib/prior-return";
import { AmendmentError, prepareAmendment } from "@/lib/tax-amendment";
import { ChatActionError, type ActionHandler } from "./handler";

// Last year's return from the chat (spec step 172): confirm what Jane read (the tap that
// lets her use it), say it isn't a return, or prepare the amended return. Signing it is on
// the page only.

const failed = (error: unknown): never => {
  if (error instanceof PriorReturnError || error instanceof AmendmentError) {
    throw new ChatActionError("failed", error.message);
  }
  throw error;
};
const broken = () => new ChatActionError("failed", "Something went wrong. Open Taxes instead.");

export const taxPriorConfirm: ActionHandler = {
  id: "tax.prior_confirm",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.priorReturn;
    if (!id) throw broken();
    const r = await confirmPriorReturn(userId, id, { client, now }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Confirmed: your ${r.year} return. I'm checking it against your accounts.`,
    };
  },
};

export const taxPriorNo: ActionHandler = {
  id: "tax.prior_no",
  on: "open",
  async run({ userId, message, action, client }) {
    const id = message.refs.priorReturn;
    if (!id) throw broken();
    await dismissPriorReturn(userId, id, { client }).catch(failed);
    return { answeredWith: action.label, note: "OK. I won't use it." };
  },
};

export const taxAmendPrepare: ActionHandler = {
  id: "tax.amend_prepare",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const year = message.refs.taxYear;
    if (typeof year !== "number") throw broken();
    await prepareAmendment(userId, year, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: your ${year} amended return is ready. Review and sign it on Last year's return; nothing is sent until you do.`,
    };
  },
};
