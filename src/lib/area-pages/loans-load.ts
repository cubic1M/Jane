import { areaOfCapability } from "@/config/areas";
import { loansTree } from "@/lib/area-pages/loans";
import { loadBnpl } from "@/lib/bnpl";
import { loadCredit } from "@/lib/credit";
import { loadDebtReview } from "@/lib/debt-review";
import { loadPayoff } from "@/lib/debt-plan";
import { scopedFor } from "@/lib/db-scoped";
import { loadDebts } from "@/lib/debts";
import { assetPrompts } from "@/lib/owned-assets";

// Everything the Loans & credit tree is built from (docs/design/area-pages.md), loaded once for
// the Loans page and for the home tree, so both show the same statuses.
export async function loadLoansArea(userId: string, { now = new Date() }: { now?: Date } = {}) {
  const db = scopedFor(userId);
  const book = await loadDebts(userId);
  const [loans, linked, bnpl, suggestions, payoff, credit, review] = await Promise.all([
    db.accounts.findMany({
      where: { type: "loan" },
      select: { id: true, name: true, type: true, subtype: true },
    }),
    // Mortgages and car loans with a home or car linked (spec step 67).
    db.ownedAssets.findMany({ select: { loanAccountId: true } }),
    // Spec step 176: the plans' installments over the next month.
    loadBnpl(userId, { book }),
    db.suggestions.findMany({
      where: { status: { in: ["waiting", "selected"] } },
      select: {
        key: true,
        capability: true,
        topic: true,
        short: true,
        why: true,
        worthCents: true,
        worthKind: true,
        urgency: true,
        actionLabel: true,
        actionHref: true,
      },
      orderBy: { score: "desc" },
    }),
    loadPayoff(userId, { book }),
    loadCredit(userId, { book }),
    loadDebtReview(userId, { book }),
  ]);
  const prompts = assetPrompts(
    loans,
    linked.map((o) => o.loanAccountId),
  );
  const mine = suggestions.filter((s) => areaOfCapability(s.capability) === "loans");
  const accounts = book.debts.filter((d) => d.inNetWorth);
  const plans = book.debts.filter((d) => !d.inNetWorth);
  const latest = credit.available ? credit.latest : null;

  const area = loansTree({
    asOf: now.toISOString().slice(0, 10),
    debts: [...accounts, ...plans],
    suggestions: mine,
    installments: bnpl.installments.length,
    payoff: book.debts.length > 0 ? { debtFreeMonth: payoff.debtFreeMonth } : null,
    credit: latest
      ? {
          score: latest.score,
          share: latest.utilisation?.share ?? null,
          toUnderHighCents: latest.utilisation?.toUnderHighCents ?? 0,
        }
      : null,
    review: review.available
      ? {
          needYou: review.items.filter((i) => i.status === "tap").length,
          on: review.review?.on ?? null,
        }
      : null,
  });
  return { book, bnpl, prompts, mine, accounts, plans, area };
}
