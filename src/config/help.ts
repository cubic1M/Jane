// Help inside the chat (spec step 140): "help" in groups, each with a page to open, and
// the first-run conversation. The examples are things the rules understand; they're
// checked with the standard guardrails like any answer, so they stay plain (no tax or
// investing words: those pages are linked instead).

export type HelpGroup = {
  title: string;
  examples: readonly string[];
  link: { label: string; href: string };
};

export const HELP_GROUPS: readonly HelpGroup[] = [
  {
    title: "Your money",
    examples: ["safe to spend", "what's due this week", "how much did I spend on food last month"],
    link: { label: "See today", href: "/home" },
  },
  {
    title: "Jane does it for you",
    examples: [
      "cancel Hulu",
      "lower my phone bill",
      "get my refund from Target",
      "approve the safe ones",
    ],
    link: { label: "Open the plan", href: "/plan" },
  },
  {
    title: "Plans",
    examples: ["can I afford $900 for a trip in March", "how was my week?", "I'm moving"],
    link: { label: "Can I afford it?", href: "/afford" },
  },
  {
    title: "What Jane noticed",
    examples: ["what changed?", "what did you do", "how much have you saved me?"],
    link: { label: "What Jane saved you", href: "/saved" },
  },
  {
    title: "Insurance",
    examples: ["what does my car insurance cover?", "when does my car insurance renew?"],
    link: { label: "See insurance", href: "/insurance" },
  },
];

// More pages, linked under the groups.
export const HELP_MORE_LINKS: readonly { label: string; href: string }[] = [
  { label: "Loans", href: "/loans" },
  { label: "Taxes", href: "/taxes" },
  { label: "Investments", href: "/investments" },
  { label: "How much Jane does", href: "/settings#autopilot" },
];
