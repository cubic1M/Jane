import { byDate, evidenceOf, sumCents } from "../helpers";
import type { Candidate, DetectionAccount, DetectionInput, DetectionTransaction } from "../types";

// Shared by bank fees and card interest: total the matching charges per account over the
// lookback window. Refunds in the same category net out; nothing is found if the net is zero
// or less.
export function totalsByAccount(
  input: DetectionInput,
  transactions: DetectionTransaction[],
  build: (
    account: DetectionAccount | undefined,
    totalCents: number,
  ) => Pick<Candidate, "type" | "title">,
): Candidate[] {
  const byAccount = new Map<string, DetectionTransaction[]>();
  for (const t of transactions)
    byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);

  return [...byAccount.keys()].sort().flatMap((accountId): Candidate[] => {
    const charges = (byAccount.get(accountId) ?? []).sort(byDate);
    const total = sumCents(charges);
    if (total <= 0) return [];
    const account = input.accounts.find((a) => a.id === accountId);
    // Keyword rules and Plaid are reliable on fee lines; an LLM guess is less certain.
    const sure = charges.every((c) => c.categorySource === "rule" || c.categorySource === "plaid");
    return [
      {
        ...build(account, total),
        key: `account:${accountId}`,
        annualSavingsCents: total,
        amountCents: total,
        confidence: sure ? "high" : "medium",
        evidence: {
          accountId,
          accountName: account?.name ?? null,
          totalCents: total,
          transactions: charges.map((c) => ({ ...evidenceOf(c), category: c.pfcDetailed })),
        },
      },
    ];
  });
}
