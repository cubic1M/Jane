import type { ActionType } from "@/generated/prisma/client";

// What the concierge team does for each action type, shown on the admin action page.
// Plain steps a new team member can follow. More action types get one in step 21.

export type Playbook = {
  steps: string[];
  // What to ask the person for, if anything, before starting.
  askFor: string[];
  // When the action counts as done, and what to record.
  close: string;
};

export const PLAYBOOKS: Partial<Record<ActionType, Playbook>> = {
  request_refund: {
    steps: [
      "Check the evidence on the card: dates, amounts, and (for a charge after cancelling) the date we cancelled.",
      "Contact the merchant first (support chat, email or phone). Say which charge, when, and why it should be refunded: charged twice, charged after cancelling, or a trial the person didn't mean to keep.",
      "For a trial, also cancel the subscription so it doesn't charge again.",
      "If the merchant refuses or doesn't answer within 5 business days, set the action to Waiting on user and ask the person to dispute the charge with their card company. Give them the merchant's name, the date and amount, and what the merchant said.",
      "Never ask for or use the person's card number or bank login.",
    ],
    askFor: [
      "Confirm they didn't make the purchase twice on purpose (double charges).",
      "The email address on their account with the merchant, if the merchant asks for it.",
    ],
    close:
      "Done when the refund shows on their account, or the merchant confirms it in writing: note the amount refunded and the minutes spent. Failed if the merchant and the card dispute both refuse; note why.",
  },
};
