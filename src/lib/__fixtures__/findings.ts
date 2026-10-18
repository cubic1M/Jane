import { CARD, CHECKING, input, sampleYear, tx } from "@/detection/__fixtures__/build";
import { detect } from "@/detection/detect";
import type { Candidate } from "@/detection/types";

// Made-up findings of every type, straight from the detection rules, with bank data that
// must never reach Claude: a person's name and a card number in a description, and a
// person's name in an account name.
export const SECRET_STRINGS = ["Jordan Rivera", "4111", "Jordan's Everyday Checking", "acct_"];

export function sampleFindings(): Candidate[] {
  const year = sampleYear();
  return detect(
    input({
      ...year,
      // A low checking balance, so the bills forecast finds a low_balance_risk too.
      accounts: [
        { ...CHECKING, name: "Jordan's Everyday Checking", currentBalanceCents: 5_000 },
        ...year.accounts.slice(1),
      ],
      transactions: [
        ...year.transactions,
        tx({
          date: "2026-06-10",
          accountId: CHECKING.id,
          amountCents: 3500,
          description: "OVERDRAFT FEE FOR CARD 4111 JORDAN RIVERA",
          pfcPrimary: "BANK_FEES",
          pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
        }),
        // Charged twice the same day.
        ...[1, 2].map(() =>
          tx({
            date: "2026-10-02",
            accountId: CARD.id,
            amountCents: 4999,
            description: "GADGET SHOP 12 JORDAN RIVERA",
            merchantName: "Gadget Shop",
            pfcPrimary: "GENERAL_MERCHANDISE",
            pfcDetailed: "GENERAL_MERCHANDISE_ELECTRONICS",
          }),
        ),
        // A $1 trial that became a full charge.
        ...[
          { date: "2026-09-20", amountCents: 100 },
          { date: "2026-10-04", amountCents: 1299 },
        ].map((t) =>
          tx({
            ...t,
            accountId: CARD.id,
            description: "STREAMFLIX TRIAL 4111",
            merchantName: "Streamflix",
            pfcPrimary: "ENTERTAINMENT",
            pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
          }),
        ),
      ],
      // We cancelled Hulu, and it kept charging.
      cancelledMerchants: [{ merchantKey: "hulu", cancelledOn: "2026-09-01" }],
    }),
  );
}

export function findingOfType(type: Candidate["type"]): Candidate {
  const finding = sampleFindings().find((f) => f.type === type);
  if (!finding) throw new Error(`no ${type} in the sample`);
  return finding;
}

export { CARD };
