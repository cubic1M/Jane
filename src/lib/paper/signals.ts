import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { signalCard, type SignalCard } from "./wording";

// The trade pop-up's list: every waiting paper trade, newest first, as its card says it. One the
// advice rule doesn't allow (or that fails its guardrail check) is left out.

export type SignalForPopup = {
  id: string;
  ticker: string;
  side: string;
  amountCents: number;
  priceCents: number;
  source: string;
  createdAt: string;
  card: SignalCard;
};

export async function openSignalCards(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<SignalForPopup[]> {
  const rows = await scopedFor(userId, client).paperSignals.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return [];
  const advice = await adviceMode(userId, { client });
  return rows.flatMap((r) => {
    const card = signalCard(r, { advice });
    return card
      ? [
          {
            id: r.id,
            ticker: r.ticker,
            side: r.side,
            amountCents: r.amountCents,
            priceCents: r.priceCents,
            source: r.source,
            createdAt: r.createdAt.toISOString(),
            card,
          },
        ]
      : [];
  });
}
