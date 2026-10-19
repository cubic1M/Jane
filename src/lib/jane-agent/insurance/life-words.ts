import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { LIFE_HEALTH_QUESTIONS } from "@/config/insurance";
import type { LifeApplication, LifeQuote } from "@/lib/insurance/life";
import { methodLines } from "@/lib/insurance/life-need";
import { nextLifeQuestion } from "@/lib/insurance/life-underwriting";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Life insurance in Jane's chat (spec step 153): how much and for how long with the method,
// the best quote, the health questions one at a time, and the carrier's decision. Each
// step that commits the person (applying, buying) is its own tap. Pure.

export const LIFE_LINK: MessageAction = {
  id: "open",
  label: "Life cover",
  kind: "link",
  href: "/insurance/life",
};

const dateWords = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const per = (q: Pick<LifeQuote, "premiumFrequency">) =>
  PREMIUM_FREQUENCIES[q.premiumFrequency].label;

export const DEPENDANTS_QUESTION: { body: string; actions: MessageAction[] } = {
  body: "One question so I can check your life cover: does anyone depend on your income, like children or a partner?",
  actions: [
    { id: "lifecover.dependants_0", label: "No one", kind: "secondary" },
    { id: "lifecover.dependants_1", label: "1 person", kind: "primary" },
    { id: "lifecover.dependants_2", label: "2 people", kind: "secondary" },
    { id: "lifecover.dependants_3", label: "3 or more", kind: "secondary" },
  ],
};

export const bestQuote = (application: Pick<LifeApplication, "quotes">, asOf: string) =>
  application.quotes.find((q) => q.expiresAt > asOf) ?? null;

export const chosenQuote = (application: Pick<LifeApplication, "quotes" | "quoteId">) =>
  application.quotes.find((q) => q.partnerQuoteId === application.quoteId) ?? null;

// Pure: the amount and term, the method, and the best price.
export function sizedBody(application: LifeApplication, asOf: string): string {
  const best = bestQuote(application, asOf);
  return [
    `You'd need about ${formatCents(application.amountCents)} of term life insurance for ${application.termYears} years. Here's how I worked it out:`,
    ...methodLines({ ...application, lines: application.method }),
    best
      ? `The best price I found: ${best.carrier.name} at ${formatCents(best.premiumCents)} ${per(best)}, before their health questions.`
      : "I couldn't get quotes just now; I'll try again.",
    "Applying is a few health questions, and nothing is bought without your tap.",
  ].join("\n");
}

export function sizedActions(application: LifeApplication, asOf: string): MessageAction[] {
  const best = bestQuote(application, asOf);
  return [
    ...(best
      ? [
          {
            id: "lifecover.apply",
            label: `Apply with ${best.carrier.name}`,
            kind: "primary",
          } satisfies MessageAction,
        ]
      : []),
    LIFE_LINK,
    { id: "lifecover.dismiss", label: "Not now", kind: "secondary" },
  ];
}

// Pure: the next health question, or the summary before Send.
export function askingStep(application: LifeApplication): {
  body: string;
  actions: MessageAction[];
} {
  const key = nextLifeQuestion(application.answers);
  const quote = chosenQuote(application);
  if (key) {
    const index = LIFE_HEALTH_QUESTIONS.findIndex((q) => q.key === key);
    return {
      body: `Question ${index + 1} of ${LIFE_HEALTH_QUESTIONS.length}: ${LIFE_HEALTH_QUESTIONS[index].text}`,
      actions: [
        { id: "lifecover.yes", label: "Yes", kind: "secondary" },
        { id: "lifecover.no", label: "No", kind: "primary" },
        LIFE_LINK,
      ],
    };
  }
  return {
    body: `That's every question. I'll send your application to ${quote?.carrier.name ?? "the carrier"} for ${formatCents(application.amountCents)} over ${application.termYears} years. They set the final price from your answers, and you decide whether to buy.`,
    actions: [{ id: "lifecover.submit", label: "Send application", kind: "primary" }, LIFE_LINK],
  };
}

const RATE_WORDS = {
  preferred: "their best rate",
  standard: "their standard rate",
  tobacco: "their tobacco rate",
} as const;

// Pure: the carrier's decision.
export function decisionStep(application: LifeApplication): {
  body: string;
  actions: MessageAction[];
} {
  const quote = chosenQuote(application);
  const carrier = quote?.carrier.name ?? "The carrier";
  const decision = application.decision;
  if (decision?.outcome === "offered") {
    return {
      body: [
        `${carrier} offers you ${formatCents(application.amountCents)} of cover for ${application.termYears} years at ${formatCents(decision.premiumCents)} ${quote ? per(quote) : "a month"}, ${RATE_WORDS[decision.rateClass]}. Buy it?`,
        ...(decision.offerExpiresAt
          ? [`The offer is open until ${dateWords(decision.offerExpiresAt)}.`]
          : []),
      ].join("\n"),
      actions: [
        { id: "lifecover.buy", label: "Buy it", kind: "primary" },
        { id: "lifecover.dismiss", label: "No thanks", kind: "secondary" },
        LIFE_LINK,
      ],
    };
  }
  return {
    body: `${carrier} wants to review your application itself. ${decision?.outcome === "referred" ? decision.reason : ""} Our team will follow up with you about the next step.`.replace(
      /\s+/g,
      " ",
    ),
    actions: [LIFE_LINK],
  };
}

export const boughtNote = (application: LifeApplication) => {
  const quote = chosenQuote(application);
  return `Done. ${quote?.carrier.name ?? "Your new carrier"} covers you for ${formatCents(application.amountCents)} for ${application.termYears} years, starting tomorrow. It's on your insurance.`;
};

// Why no life cover is suggested.
export const NOT_NEEDED = {
  no_dependants:
    "Thanks. With no one depending on your income, you don't need life insurance now. Tell me if that changes.",
  no_pay: "Thanks. I'll size your life cover once I can see your paychecks.",
  covered: "Thanks. Your savings and the cover you have already meet what your family would need.",
} as const;
