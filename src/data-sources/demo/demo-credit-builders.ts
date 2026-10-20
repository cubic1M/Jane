// Stand-in credit-builder products for the demo bank (spec step 175), for a thin credit
// file: made-up issuers with realistic terms. Marked demo and labelled as samples; never
// offered to a real account.

const EXAMPLE = "https://example.com/jane-demo/credit-builders";

export type CreditBuilderProduct = {
  id: string;
  issuer: string;
  name: string;
  kind: "secured_card" | "builder_loan";
  // A secured card's deposit, which becomes its limit; a builder loan's amount, held in
  // savings and paid out at the end.
  amountCents: number;
  // A builder loan's monthly payment and months; null for a card.
  monthlyCents: number | null;
  months: number | null;
  // An annual fee, or a builder loan's interest over its term.
  costCents: number;
  summary: string;
  sourceUrl: string;
  demo: boolean;
};

export const DEMO_CREDIT_BUILDERS: readonly CreditBuilderProduct[] = [
  {
    id: "willow-secured",
    issuer: "Willow Credit Union",
    name: "Willow Secured Card",
    kind: "secured_card",
    amountCents: 20_000,
    monthlyCents: null,
    months: null,
    costCents: 0,
    summary:
      "A $200 deposit becomes your limit; reported to all three bureaus; no annual fee. Use it for one small bill and pay it in full each month.",
    sourceUrl: `${EXAMPLE}/willow-secured`,
    demo: true,
  },
  {
    id: "maple-builder",
    issuer: "Maple Community Bank",
    name: "Maple Credit Builder Loan",
    kind: "builder_loan",
    amountCents: 60_000,
    monthlyCents: 5_250,
    months: 12,
    costCents: 3_000,
    summary:
      "$600 held in savings for you while you pay $52.50 a month for 12 months, then it's yours; each payment is reported. About $30 in interest over the year.",
    sourceUrl: `${EXAMPLE}/maple-builder`,
    demo: true,
  },
];
