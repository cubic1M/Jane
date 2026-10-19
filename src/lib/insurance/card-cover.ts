import type { CardBenefit } from "@/config/card-benefits";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoItemId } from "@/lib/plaid/demo";
import { cardCatalog } from "./card-benefits";

export { conditionWords, limitWords } from "./card-benefits";

// Cover the person already has through their cards (spec step 152): each card the
// card-benefits catalog knows, its cover with the limits and what the person must do for
// it to apply, and the plans Jane found they pay for twice (covered_by_card findings,
// cancelled through the usual one-tap flow).

type Options = { client?: PrismaClient };

export type CardCover = {
  accountId: string;
  card: string;
  reviewedOn: string;
  benefits: CardBenefit[];
};

export type Duplicate = {
  findingId: string;
  title: string;
  merchant: string;
  card: string;
  benefit: string;
  annualSavingsCents: number | null;
  status: string;
};

export async function cardCover(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<{ cards: CardCover[]; duplicates: Duplicate[] }> {
  const db = scopedFor(userId, client);
  const [accounts, findings] = await Promise.all([
    db.accounts.findMany({
      where: { type: "credit" },
      select: { id: true, name: true, type: true, item: { select: { plaidItemId: true } } },
      orderBy: { id: "asc" },
    }),
    db.findings.findMany({
      where: {
        type: "covered_by_card",
        status: { in: ["new", "shown", "approved", "in_progress", "done"] },
      },
      select: { id: true, title: true, evidence: true, annualSavingsCents: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const catalog = cardCatalog();
  const cards = accounts.flatMap((a): CardCover[] => {
    const product = catalog.productFor({
      id: a.id,
      name: a.name,
      type: a.type,
      demo: a.item !== null && isDemoItemId(a.item.plaidItemId),
    });
    return product
      ? [
          {
            accountId: a.id,
            card: product.name,
            reviewedOn: product.reviewedOn,
            benefits: [...product.benefits],
          },
        ]
      : [];
  });
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const duplicates = findings.map((f) => {
    const e = (f.evidence ?? {}) as Record<string, unknown>;
    return {
      findingId: f.id,
      title: f.title,
      merchant: text(e.merchant),
      card: text(e.card),
      benefit: text(e.benefit),
      annualSavingsCents: f.annualSavingsCents,
      status: f.status,
    };
  });
  return { cards, duplicates };
}
