// The investments upload on /import (src/lib/import/positions.ts): the account types a person
// can pick for an uploaded brokerage account, as Plaid's investment subtypes, in the words the
// investments page uses (subtypeLabel in src/insights/investments.ts).
export const POSITIONS_SUBTYPES = [
  { value: "brokerage", label: "Brokerage" },
  { value: "ira", label: "IRA" },
  { value: "roth", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "roth 401k", label: "Roth 401(k)" },
  { value: "403b", label: "403(b)" },
  { value: "457b", label: "457(b)" },
  { value: "sep ira", label: "SEP IRA" },
  { value: "simple ira", label: "SIMPLE IRA" },
  { value: "hsa", label: "HSA" },
  { value: "529", label: "529 college savings" },
  { value: "custodial", label: "Custodial (child's)" },
] as const;

export const isPositionsSubtype = (value: unknown): value is string =>
  POSITIONS_SUBTYPES.some((s) => s.value === value);

// The brokerages whose downloads Jane reads, with where to find each.
export const BROKER_DOWNLOADS: readonly { broker: string; steps: string }[] = [
  { broker: "Fidelity", steps: "Accounts > Positions, then the download icon (CSV)." },
  { broker: "Schwab", steps: "Accounts > Positions, then Export (CSV)." },
  { broker: "Vanguard", steps: "Download center > a CSV of your holdings and transactions." },
  {
    broker: "Robinhood",
    steps:
      "Account > Reports and statements > Reports: the account activity report, from the day you opened the account.",
  },
];
