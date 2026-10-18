import type { ActionType } from "@/generated/prisma/client";

// What the concierge team does for each action type, shown on the admin action page.
// Plain steps a new team member can follow.

export type Playbook = {
  steps: string[];
  // What to ask the person for, if anything, before starting.
  askFor: string[];
  // When the action counts as done, and what to record.
  close: string;
  // What to say on the call, when there's a call to make.
  script?: string[];
};

// Every playbook ends the same way when the person has to do something.
const WAITING =
  "If only the person can do the next step, set Waiting on user and write exactly what they need to do.";

export const PLAYBOOKS: Record<ActionType, Playbook> = {
  cancel_subscription: {
    steps: [
      "Check the card for the merchant, the latest charge and how often it bills.",
      "Cancel through the merchant's website, chat or phone line. Use the drafted message below if they need it in writing.",
      "Ask for written confirmation (an email or a confirmation number) and the date the last charge will be.",
      "For a duplicate-services card, the person picks which service to keep before you cancel anything.",
      WAITING,
    ],
    askFor: [
      "Which service to keep, if the card covers more than one.",
      "The login email for the account, if the merchant needs it to find them.",
    ],
    close:
      "Done when you have the confirmation: put the confirmation number or email in the notes. If it charges again, the charge-after-cancel finding will catch it.",
  },
  fight_price_increase: {
    steps: [
      "Check the card: the old price, the new price, and when it changed.",
      "Contact the merchant and ask to keep the old price, for a loyalty discount, or for a cheaper plan with the same service.",
      "Write down every offer. Don't accept a plan change without the person.",
      WAITING,
    ],
    askFor: ["What they can't give up in the current plan."],
    close:
      "Done when a lower price is confirmed: note the new price. Failed if nothing cheaper is offered; note the best offer.",
  },
  recover_bank_fees: {
    steps: [
      "List the fees from the card evidence: dates, amounts and kind (overdraft, late, ATM).",
      "Contact the bank or card company and ask them to refund the fees as a courtesy. First-time and recent fees are refunded most often.",
      "Ask what would stop them happening again: low-balance alerts, overdraft settings, or a no-fee account.",
      WAITING,
    ],
    askFor: ["Permission to call the bank on their behalf, or a time for a three-way call."],
    close:
      "Done when a refund is confirmed: note how much came back. Failed if the bank refuses; note the reason given.",
  },
  move_idle_cash: {
    steps: [
      "Check the card: how much cash is above their cushion.",
      "Share two or three FDIC-insured high-yield savings accounts and their current rates, and how to open one. Never pick for them, and never mention investments.",
      "Once they've opened an account, remind them how to move the money (they move it themselves).",
      WAITING,
    ],
    askFor: [
      "Whether they'd rather keep it at their current bank (ask the bank for a better savings rate).",
    ],
    close:
      "Done when the person confirms the money moved. Failed if they decide to leave it; note why.",
  },
  insurance_reshop: {
    steps: [
      "Check the card: the insurer and what they pay a year.",
      "Ask the person for their current declarations page so quotes match the same coverage.",
      "Get quotes with the same coverage and deductibles. Only use referral partners listed in src/config/referrals.ts, and show the disclosure.",
      "Show the person the quotes side by side. They choose; never switch a policy for them.",
      WAITING,
    ],
    askFor: ["Their declarations page (coverage, limits and deductibles)."],
    close:
      "Done when they switch to a cheaper policy or decide to keep theirs after seeing quotes: note the yearly difference. Failed if no quote is cheaper.",
  },
  card_interest: {
    steps: [
      "Check the card: interest paid over the last 12 months.",
      "Ask the card company for a lower rate.",
      "Share how balance transfer offers work, including the one-time fee, and point them to the debt planner at /debt. Don't recommend a specific card or plan.",
      WAITING,
    ],
    askFor: ["Their current APR and minimum payment, if they know them."],
    close:
      "Done when a lower rate is confirmed or the person has what they need to decide: note the new APR. Failed if the issuer refuses.",
  },
  review_cash_flow: {
    steps: [
      "Check the card: the bills before the low point and when income arrives.",
      "Ask each biller whether the due date can move to a few days after payday.",
      "Remind the person a few days before the forecast low point.",
      WAITING,
    ],
    askFor: ["Their payday, if it isn't clear from the deposits."],
    close: "Done when due dates have moved or the person has been reminded: note what changed.",
  },
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
