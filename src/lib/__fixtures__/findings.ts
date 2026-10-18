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
      accounts: [{ ...CHECKING, name: "Jordan's Everyday Checking" }, ...year.accounts.slice(1)],
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
      ],
    }),
  );
}

export function findingOfType(type: Candidate["type"]): Candidate {
  const finding = sampleFindings().find((f) => f.type === type);
  if (!finding) throw new Error(`no ${type} in the sample`);
  return finding;
}

export { CARD };
