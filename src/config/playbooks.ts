import type { ActionType } from "@/generated/prisma/client";

// What the concierge team does for each action type, shown on the admin action page.
// Plain steps a new team member can follow. More action types get one in step 21.

export type Playbook = {
  steps: string[];
  // What to ask the person for, if anything, before starting.
  askFor: string[];
  // When the action counts as done, and what to record.
  close: string;
  // What to say on the call, when there's a call to make.
  script?: string[];
};

export const PLAYBOOKS: Partial<Record<ActionType, Playbook>> = {
  negotiate_bill: {
    steps: [
      "Check the card: the provider, what they pay a month, and the typical price range we showed them.",
      'Call or chat with the provider\'s retention or loyalty team (ask for "cancellations" if the menu has no loyalty option). Use the script below.',
      "Write down every offer: new monthly price, how long it lasts, any contract or equipment change.",
      "Don't accept anything yourself. Set the action to Waiting on user with the offers, and accept only the one the person picks.",
      "If the provider needs the account holder on the line, set Waiting on user and ask for a time to do a three-way call.",
    ],
    askFor: [
      "The account holder's name and the account PIN or security answer the provider uses.",
      "Anything they don't want to lose (a channel, a speed, a phone line).",
    ],
    close:
      "Done when the person accepts a lower price and it shows on the next bill: note the new monthly price and minutes spent. Failed if no offer beats the current price; note what was offered.",
    script: [
      "Hi, I'm calling on behalf of [name], the account holder, about their bill.",
      "They've been a customer since [year] and pay [current monthly price]. That's above what similar plans cost, and they're looking at other providers.",
      "Is there a loyalty discount, a current promotion, or a cheaper plan with the same [speed / lines / channels]?",
      "What would the new monthly price be, for how long, and is there a contract or any fee?",
      "Thank you. I'll check with [name] and call back to accept, so please note these offers on the account.",
    ],
  },
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
