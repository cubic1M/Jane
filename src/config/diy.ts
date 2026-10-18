import type { ActionType } from "@/generated/prisma/client";

// Do-it-yourself kits: for actions a person can often do faster themselves, the steps
// to follow and which of the merchant's links to show. Actions not listed here have no
// kit (moving cash, insurance quotes, due dates and card rates take more than a link).

export type DiyKitConfig = {
  // The merchant directory link to show first.
  link: "cancel" | "support";
  steps: string[];
  // An email to write, or a call script to read.
  message: "email" | "call";
};

export const DIY_KITS: Partial<Record<ActionType, DiyKitConfig>> = {
  cancel_subscription: {
    link: "cancel",
    steps: [
      "Open the company's account page (link below) and sign in.",
      "Find the subscription or membership settings and choose cancel.",
      "Keep the confirmation email or number until the next billing date passes.",
    ],
    message: "email",
  },
  fight_price_increase: {
    link: "support",
    steps: [
      "Contact the company's support (link below), by chat or email.",
      "Ask to keep your previous price, for a loyalty discount, or for a cheaper plan with the same service.",
      "If they offer something, check the new price and how long it lasts before you accept.",
    ],
    message: "email",
  },
  request_refund: {
    link: "support",
    steps: [
      "Contact the company's support (link below) and ask for a refund of the charges listed.",
      "If they say no or don't answer within a week, ask your card company to dispute the charge.",
    ],
    message: "email",
  },
  recover_bank_fees: {
    link: "support",
    steps: [
      "Call your bank or card company, or message them in their app.",
      "Ask them to refund the fees listed as a courtesy; first-time fees are often refunded.",
      "Ask how to avoid them in future, like low-balance alerts.",
    ],
    message: "email",
  },
  negotiate_bill: {
    link: "support",
    steps: [
      "Call the provider and ask for the loyalty or retention team.",
      "Use the script below, and write down every offer.",
      "Only accept a deal once you know the new price, how long it lasts, and any contract.",
    ],
    message: "call",
  },
};
