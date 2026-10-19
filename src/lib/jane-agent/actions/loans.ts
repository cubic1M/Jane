import { formatRate } from "@/insights/loans";
import {
  LoanApplicationError,
  acceptLoan,
  prepareApplication,
  submitApplication,
  withdrawApplication,
  type LoanApplicationView,
} from "@/lib/loan-applications";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";
import { ChatActionError, type ActionHandler } from "./handler";

// One-tap apply from the chat (spec step 112), through the applications' own code
// (src/lib/loan-applications.ts). "Apply" prepares the application and shows its terms in
// place; only "Submit" sends it (a soft check), and only "Accept" signs for the loan.

const failed = (error: unknown) => {
  if (error instanceof LoanApplicationError) return new ChatActionError("failed", error.message);
  return error;
};

const review = (id: string): MessageAction => ({
  id: "open",
  label: "Review it in full",
  kind: "link",
  href: `/loans/apply/${id}`,
});

// The terms, as the person reviews them before submitting.
export function termsText(app: LoanApplicationView): string {
  return [
    `Here's the application I prepared for ${app.lender}. Check the terms before you submit:`,
    `- Pays off: your ${app.oldName}, ${formatCents(app.amountCents)}`,
    `- Rate: ${formatRate(app.aprBps)} ${app.rateType} for ${app.termMonths} months`,
    `- Payment: ${formatCents(app.monthlyCents)} a month`,
    `- Fee: ${app.feeCents === 0 ? "none" : formatCents(app.feeCents)}`,
    `- In all: ${formatCents(app.totalCents)}, ${formatCents(app.savingCents)} less than keeping it`,
    `- Sent with it: your name and email, and the loan it pays off. Submitting is a soft check, which doesn't affect a credit score.`,
    "This is a sample offer from a stand-in lender catalog.",
  ].join("\n");
}

export const loanPrepare: ActionHandler = {
  id: "loan.prepare",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.refinance;
    if (!target)
      throw new ChatActionError("failed", "Something went wrong. Open the offers instead.");
    try {
      const app = await prepareApplication(userId, target, { client, now });
      return {
        status: "open",
        body: termsText(app),
        answeredWith: action.label,
        refs: { ...message.refs, applicationId: app.id },
        actions: [
          { id: "loan.submit", label: "Submit the application", kind: "primary" },
          { id: "loan.withdraw", label: "Don't apply", kind: "secondary" },
          review(app.id),
        ],
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const loanSubmit: ActionHandler = {
  id: "loan.submit",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.applicationId;
    if (!id)
      throw new ChatActionError("failed", "Something went wrong. Open the application instead.");
    try {
      // The terms are on this message, above the button: reviewing them is tapping it.
      const app = await submitApplication(userId, id, { reviewed: true }, { client, now });
      if (app.status === "declined") {
        return {
          answeredWith: action.label,
          note: `${app.lender} declined it after the soft check. Nothing changes on your ${app.oldName}.`,
        };
      }
      return {
        status: "open",
        answeredWith: action.label,
        note: `${app.lender} approved you on these terms. Accept the loan to sign for it; nothing is signed until you do.`,
        actions: [
          { id: "loan.accept", label: "Accept the loan", kind: "primary" },
          { id: "loan.withdraw", label: "Don't take it", kind: "secondary" },
          review(app.id),
        ],
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const loanAccept: ActionHandler = {
  id: "loan.accept",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const id = message.refs.applicationId;
    if (!id)
      throw new ChatActionError("failed", "Something went wrong. Open the application instead.");
    try {
      const app = await acceptLoan(userId, id, { client, now });
      return {
        answeredWith: action.label,
        note: `Accepted. ${app.lender} pays off your ${app.oldName} next; I'll tell you when your bank shows it at zero.`,
        actions: [review(app.id)],
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const loanWithdraw: ActionHandler = {
  id: "loan.withdraw",
  on: "open",
  async run({ userId, message, action, client }) {
    const id = message.refs.applicationId;
    try {
      if (id) await withdrawApplication(userId, id, { client });
    } catch (error) {
      throw failed(error);
    }
    return {
      answeredWith: action.label,
      note: "OK. Nothing was sent, and your loan stays as it is.",
    };
  },
};
