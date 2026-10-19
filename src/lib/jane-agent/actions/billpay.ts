import { formatCents } from "@/lib/money";
import { BillPayError, payBill } from "@/lib/money-movement/bill-pay";
import { shortDate } from "../sources/source";
import {
  ChatActionError,
  answeredElsewhere,
  linksOf,
  type ActionContext,
  type ActionHandler,
} from "./handler";

// Buttons on a bill to pay (spec step 145): Pay it (the person's one tap, checked again
// against checking's forecast at that moment) and I'll pay it myself, which only answers it
// (the button itself is audited with every chat action).

function keyOf({ message }: ActionContext) {
  const key = message.refs.billKey;
  if (!key) throw new ChatActionError("failed", "Something went wrong. Open Transfers instead.");
  return key;
}

export const billPay: ActionHandler = {
  id: "bill.pay",
  on: "open",
  async run(context) {
    const { userId, client, now, message } = context;
    try {
      const paid = await payBill(userId, keyOf(context), "person", { client, now });
      return {
        answeredWith: context.action.label,
        note: `Done. ${formatCents(paid.amountCents)} goes to ${paid.name} on ${shortDate(paid.runOn)}; you can undo it on Transfers until then.`,
        actions: linksOf(message.actions),
      };
    } catch (error) {
      if (error instanceof BillPayError) throw answeredElsewhere(error.message);
      throw error;
    }
  },
};

export const billSkip: ActionHandler = {
  id: "bill.skip",
  on: "open",
  async run(context) {
    keyOf(context);
    return {
      answeredWith: context.action.label,
      note: "OK, I'll leave that one to you.",
    };
  },
};
