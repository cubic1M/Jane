import type { ActionType } from "@/generated/prisma/client";

// Do-it-yourself kits: the steps to follow, which of the merchant's links to show, and what
// to send or say. Every action has one: for a real account (read-only mode, see
// CONCIERGE_ACTIONS) the kit is how it gets done, since there's no team to do it for them.

export type DiyKitConfig = {
  // The merchant directory link to show first.
  link: "cancel" | "support";
  steps: string[];
  // An email to write, a call script to read, or neither (the steps are the whole kit).
  message: "email" | "call" | "none";
  // What a yes means for a real account, in place of the card's "We ...": what they do.
  summary: string;
};

// A card's annual fee alone (debugger 10-30: an Amex Gold's $325 annual fee got the overdraft
// steps). It isn't refunded as a courtesy like an overdraft: card companies waive it or offer a
// credit to keep the card, or move it to their no-fee card, which keeps the account's history.
export const ANNUAL_FEE_KIT: DiyKitConfig = {
  link: "support",
  steps: [
    "Call the number on the back of your card before the next annual fee, or soon after it posts.",
    "Ask whether they can waive the fee or offer a credit to keep the card.",
    "If you don't use its perks, ask to move to their no-fee card instead of closing it: that keeps the account's history.",
  ],
  message: "call",
  summary:
    "You ask your card company to waive the annual fee or move you to a no-fee card: Jane gives you the steps and what to say.",
};

export const DIY_KITS: Partial<Record<ActionType, DiyKitConfig>> = {
  cancel_subscription: {
    link: "cancel",
    steps: [
      "Open the company's account page and sign in.",
      "Find the subscription or membership settings and choose cancel.",
      "Keep the confirmation email or number until the next billing date passes.",
    ],
    message: "email",
    summary: "You cancel it yourself: Jane gives you the steps and a cancellation email to copy.",
  },
  fight_price_increase: {
    link: "support",
    steps: [
      "Contact the company's support, by chat or email.",
      "Ask to keep your previous price, for a loyalty discount, or for a cheaper plan with the same service.",
      "If they offer something, check the new price and how long it lasts before you accept.",
    ],
    message: "email",
    summary:
      "You ask the company for your old price or a cheaper plan: Jane gives you the steps and an email to copy.",
  },
  request_refund: {
    link: "support",
    steps: [
      "Contact the company's support and ask for a refund of the charges listed.",
      "If they say no or don't answer within a week, ask your card company to dispute the charge.",
    ],
    message: "email",
    summary:
      "You ask the company for your money back: Jane gives you the steps and an email to copy.",
  },
  recover_bank_fees: {
    link: "support",
    steps: [
      "Call your bank or card company, or message them in their app.",
      "Ask them to refund the fees listed as a courtesy; first-time fees are often refunded.",
      "Ask how to avoid them in future, like low-balance alerts.",
    ],
    message: "email",
    summary:
      "You ask your bank or card company to refund these fees: Jane gives you the steps and what to say.",
  },
  negotiate_bill: {
    link: "support",
    steps: [
      "Call the provider and ask for the loyalty or retention team.",
      "Use the script below, and write down every offer.",
      "Only accept a deal once you know the new price, how long it lasts, and any contract.",
    ],
    message: "call",
    summary:
      "You call the company and ask for a lower rate or a cheaper plan: Jane gives you the steps and a call script.",
  },
  card_interest: {
    link: "support",
    steps: [
      "Call the number on the back of your card and ask for a lower interest rate.",
      "Use the script below; mention how long you've paid on time.",
      "If they say no, ask about a balance transfer or a hardship plan, and when to ask again.",
    ],
    message: "call",
    summary:
      "You ask your card company for a lower rate: Jane gives you the steps and a call script.",
  },
  move_idle_cash: {
    link: "support",
    steps: [
      "Pick a high-yield savings account: compare two or three online banks' rates, or ask your own bank for a higher one.",
      "Open it on their site; it takes about ten minutes and doesn't affect your credit score.",
      "Move the extra cash Jane found from your checking account, leaving your usual cushion behind.",
    ],
    message: "none",
    summary:
      "You open a high-yield savings account and move the extra cash yourself: Jane gives you the steps.",
  },
  insurance_reshop: {
    link: "support",
    steps: [
      "Have your current policy to hand: what's covered, the limits, the deductible and the renewal date.",
      "Get quotes for the same cover from two or three insurers, online or by phone.",
      "Switch only once the new policy starts, and cancel the old one so the dates meet with no gap.",
    ],
    message: "none",
    summary:
      "You get quotes with the same coverage and switch only if one is cheaper: Jane gives you the steps.",
  },
  review_cash_flow: {
    link: "support",
    steps: [
      "Look at the bills due before your next payday (Coming up shows them by date).",
      "Move money from savings, or ask a company to move a due date, before the low point.",
      "Turn on a low-balance alert with your bank so you hear first.",
    ],
    message: "none",
    summary:
      "You ask your billers to move due dates to after your payday: Jane gives you the steps.",
  },
};
