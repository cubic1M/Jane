import { FamilyLoanError, confirmFamilyLoan, dismissFamilyLoan } from "@/lib/family-loans";
import { formatCents } from "@/lib/money";
import { ChatActionError, type ActionHandler } from "./handler";

// Answering whether a payment-app transfer was a loan, from the chat (spec step 226): a
// transfer is a loan only after the person says so. Jane never contacts the other person.

const failed = (error: unknown) =>
  error instanceof FamilyLoanError ? new ChatActionError("failed", error.message) : error;
const needTarget = () =>
  new ChatActionError("failed", "Something went wrong. Open who owes whom instead.");

export const famLoanYes: ActionHandler = {
  id: "famloan.yes",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.familyLoan;
    if (!target) throw needTarget();
    try {
      const loan = await confirmFamilyLoan(userId, target.id, { client, now });
      return {
        answeredWith: action.label,
        note:
          loan.kind === "lent"
            ? `Noted: ${loan.counterparty} owes you ${formatCents(loan.cents)}. I'll watch for what comes back, and draft a kind reminder for you to send if it's still open in a month. I won't message ${loan.counterparty.split(" ")[0]}.`
            : `Noted: you owe ${loan.counterparty} ${formatCents(loan.cents)}. I'll count what you send back.`,
      };
    } catch (error) {
      throw failed(error);
    }
  },
};

export const famLoanNo: ActionHandler = {
  id: "famloan.no",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const target = message.refs.familyLoan;
    if (!target) throw needTarget();
    try {
      await dismissFamilyLoan(userId, target.id, { client, now });
      return {
        answeredWith: action.label,
        note: "Got it: not a loan, and I won't ask about it again.",
      };
    } catch (error) {
      throw failed(error);
    }
  },
};
