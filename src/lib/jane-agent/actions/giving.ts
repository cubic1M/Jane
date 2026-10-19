import { GivingError, dismissGiving, markReceipt, openDonorFund } from "@/lib/giving";
import { ChatActionError, type ActionHandler } from "./handler";

// Giving from the chat (spec step 168), through src/lib/giving.ts: a gift's receipt, a
// donor-advised fund opened with the stand-in (funding it is the person's own transfer),
// and not this year.

const failed = (error: unknown): never => {
  if (error instanceof GivingError) throw new ChatActionError("failed", error.message);
  throw error;
};

export const taxReceiptGot: ActionHandler = {
  id: "tax.receipt_got",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.taxGift;
    if (!id) throw new ChatActionError("failed", "Something went wrong. Open Taxes instead.");
    const gift = await markReceipt(userId, id, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Got it: your gift to ${gift.payee} has its receipt. Keep it with your tax papers.`,
    };
  },
};

export const taxFundOpen: ActionHandler = {
  id: "tax.fund_open",
  on: "open",
  async run({ userId, action, client, now }) {
    const fund = await openDonorFund(userId, { client, now, via: "chat" }).catch(failed);
    return {
      answeredWith: action.label,
      note: `Done: ${fund.fundName} is open (a stand-in for now). Putting $${Math.round(fund.amountCents / 100).toLocaleString("en-US")} into it is on your deadlines; the money is yours to move.`,
    };
  },
};

export const taxGivingNo: ActionHandler = {
  id: "tax.giving_no",
  on: "open",
  async run({ userId, action, client, now }) {
    await dismissGiving(userId, { client, now, via: "chat" });
    return { answeredWith: action.label, note: "OK. I won't bring it up again this year." };
  },
};
