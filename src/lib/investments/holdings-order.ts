import type { Prisma } from "@/generated/prisma/client";

// The order holdings are read in, wherever they're read: largest first, then by ticker. Without
// one, rows came back in the table's order, which a sync's updates move: the fee card listed the
// same three funds in two orders and its "Your 401(k)'s menu also has …" named a different fund
// first, run to run on the same data (#2165's sweep, 11-20).
export const HOLDINGS_ORDER = [
  { valueCents: "desc" },
  { security: { ticker: "asc" } },
  { quantity: "desc" },
] as const satisfies Prisma.HoldingOrderByWithRelationInput[];
