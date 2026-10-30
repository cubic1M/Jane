import type { FindingType } from "@/generated/prisma/client";
import type { ExplainInput } from "./explain-input";

// Fixed card text for each finding type: shown when there is no API key, when Claude's
// answer fails the guardrails, and until an explanation has been generated. Uses only the
// figures in the explain input, so it passes the same guardrails.

export type ExplanationContent = {
  title: string;
  explanation: string;
  giveUp: string;
  alternatives: string[];
};

type Facts = ExplainInput["facts"];

const fact = (facts: Facts, key: string): string | null => {
  const value = facts[key];
  return typeof value === "string" ? value : null;
};

function yearly(input: ExplainInput, fallback: string): string {
  return input.savingsPerYear ? `about ${input.savingsPerYear} a year` : fallback;
}

const TEMPLATES: Record<FindingType, (input: ExplainInput) => Omit<ExplanationContent, "title">> = {
  subscription_review: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "this service";
    const charge = fact(input.facts, "latestCharge");
    const billed = fact(input.facts, "billed") ?? "regularly";
    return {
      explanation: `You pay ${merchant}${charge ? ` ${charge} ${billed}` : ` ${billed}`}, ${yearly(input, "every year")}. If you no longer use it, cancelling keeps that money in your pocket.`,
      giveUp: `You would lose access to ${merchant}.`,
      alternatives: ["Switch to a cheaper plan", "Pause it instead of cancelling", "Keep it"],
    };
  },
  duplicate_subscription: (input) => {
    const kind = fact(input.facts, "kindOfService") ?? "similar";
    return {
      explanation: `You pay for more than one ${kind} service. Keeping just one could save ${yearly(input, "money every year")}.`,
      giveUp: "You would lose whatever only the cancelled service offers.",
      alternatives: ["Rotate services month to month", "Share a family plan", "Keep both"],
    };
  },
  price_increase: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "This bill";
    const before = fact(input.facts, "previousPrice");
    const after = fact(input.facts, "latestCharge");
    const change = before && after ? ` from ${before} to ${after}` : "";
    return {
      explanation: `${merchant} raised your price${change}. Asking for the old rate or a loyalty discount could save ${yearly(input, "money every year")}.`,
      giveUp: "Nothing, unless switching plans changes what you get.",
      alternatives: [
        "Switch to a cheaper plan",
        "Cancel and sign up again as a new customer",
        "Accept the new price",
      ],
    };
  },
  bank_fees: (input) => {
    const total = fact(input.facts, "total");
    const period = fact(input.facts, "period");
    return {
      explanation: `Your bank or card company charged you${total ? ` ${total}` : ""} in fees${period ? ` in ${period}` : ""}. Banks often refund fees when asked, and a different account could stop them.`,
      giveUp: "Nothing, though switching accounts takes some setup.",
      alternatives: [
        "Turn on low-balance alerts",
        "Turn off overdraft coverage",
        "Move to a no-fee account",
      ],
    };
  },
  idle_cash: (input) => {
    const extra = fact(input.facts, "extraCash");
    const rate = fact(input.facts, "highYieldSavingsRate");
    return {
      explanation: `You keep${extra ? ` ${extra}` : " more"} beyond a few months of spending in accounts that likely pay little interest. A high-yield savings account${rate ? ` paying around ${rate}` : ""} could earn ${yearly(input, "more each year")}.`,
      giveUp: "Moving money between banks can take a few days.",
      alternatives: [
        "Ask your bank for a better savings rate",
        "Move only part of it",
        "Leave it where it is",
      ],
    };
  },
  insurance_reshop: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "your insurer";
    const cost = fact(input.facts, "yearlyCost");
    return {
      explanation: `You pay ${merchant}${cost ? ` ${cost} a year` : " regularly"} for insurance. Comparing quotes with the same coverage often finds a lower price.`,
      giveUp: "Switching insurers means new paperwork and a new company to deal with.",
      alternatives: [
        "Ask your insurer for discounts",
        "Raise your deductible",
        "Keep your current policy",
      ],
    };
  },
  low_balance_risk: (input) => {
    const lowest = fact(input.facts, "lowestBalance");
    const around = fact(input.facts, "lowestAround");
    return {
      explanation: `Your upcoming bills could take your checking account down to about ${lowest ?? "a low balance"}${around ? ` around ${around}` : ""}, before more money comes in. Moving a due date or two could keep you clear of overdraft fees.`,
      giveUp: "Nothing, though a biller may need a few days to move a due date.",
      alternatives: [
        "Move money from savings before then",
        "Pay one bill a little later",
        "Turn on low-balance alerts",
      ],
    };
  },
  duplicate_charge: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "The same company";
    const refund = fact(input.facts, "refundAmount");
    return {
      explanation: `${merchant} charged you${refund ? ` ${refund}` : ""} twice within a day. If you only bought once, the second charge can usually be refunded, by the merchant or through your card company.`,
      giveUp: "Nothing, if it really was one purchase.",
      alternatives: [
        "Ask the merchant yourself",
        "Dispute it with your card company",
        "Keep both if you bought twice",
      ],
    };
  },
  charge_after_cancel: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "This company";
    const refund = fact(input.facts, "refundAmount");
    const on = fact(input.facts, "cancelledOn");
    return {
      explanation: `We cancelled ${merchant}${on ? ` on ${on}` : ""}, but it charged you${refund ? ` ${refund}` : " again"} afterwards. Charges after a cancellation are usually refunded when you show the cancellation.`,
      giveUp: "Nothing.",
      alternatives: ["Ask the merchant yourself", "Dispute it with your card company"],
    };
  },
  trial_conversion: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "A service";
    const refund = fact(input.facts, "refundAmount");
    return {
      explanation: `${merchant} started with a free or tiny trial charge, then charged you${refund ? ` ${refund}` : " the full price"}. If you didn't mean to keep it, many companies refund a first charge when asked soon after.`,
      giveUp: `You would lose access to ${merchant}.`,
      alternatives: ["Keep it", "Cancel before the next charge without asking for a refund"],
    };
  },
  bill_negotiation: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "this provider";
    const kind = fact(input.facts, "kindOfBill") ?? "this kind of";
    const perMonth = fact(input.facts, "perMonth");
    const from = fact(input.facts, "typicalPriceFrom");
    const to = fact(input.facts, "typicalPriceTo");
    const typical = from && to ? `the typical price of ${from} to ${to}` : "the typical price";
    return {
      explanation: `You pay ${merchant}${perMonth ? ` about ${perMonth} a month` : ""}, above ${typical} for a ${kind} bill. Providers often lower a bill when a customer asks, which could save ${yearly(input, "money every year")}.`,
      giveUp: "Possibly a promotional price that ends later, or a plan with fewer extras.",
      alternatives: [
        "Ask them yourself for a loyalty offer",
        "Switch to another provider",
        "Keep your current plan",
      ],
    };
  },
  covered_by_card: (input) => {
    const merchant = fact(input.facts, "merchant") ?? "this plan";
    const card = fact(input.facts, "card") ?? "one of your cards";
    const benefit = fact(input.facts, "benefit") ?? "the same cover";
    const limits = fact(input.facts, "limits");
    const condition = fact(input.facts, "condition");
    return {
      explanation: `Your ${card} already gives you ${benefit.toLowerCase()}${limits ? ` (${limits})` : ""}${condition ? ` as long as ${condition}` : ""}. You also pay ${merchant}, ${yearly(input, "every year")}, for the same cover. Cancelling it stops you paying twice.`,
      giveUp: `Anything ${merchant} covers beyond the card's limits.`,
      alternatives: [
        "Read the card's benefit guide first",
        "Keep it for the higher limits",
        "Keep it",
      ],
    };
  },
  card_interest: (input) => {
    const total = fact(input.facts, "total");
    const period = fact(input.facts, "period");
    return {
      explanation: `You paid${total ? ` ${total}` : ""} in credit card interest${period ? ` in ${period}` : ""}. Paying the balance in full or moving it to a lower-rate card could cut that cost.`,
      giveUp: "A balance transfer usually has a one-time fee.",
      alternatives: [
        "Ask your card issuer for a lower rate",
        "Pay more than the minimum each month",
        "Set up autopay",
      ],
    };
  },
};

export function templateExplanation(title: string, input: ExplainInput): ExplanationContent {
  return { title, ...TEMPLATES[input.findingType](input) };
}
