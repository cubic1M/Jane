import { LENDER_PARTNER } from "@/config/debt";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { db as defaultClient } from "@/lib/db";
import { demoLender } from "@/lib/lenders/demo";
import type { LenderPartner } from "@/lib/lenders/partner";

// The partner for this person, or null: the stand-in only for demo-bank people in demo
// advice mode. A real account gets nothing until a loan marketplace partner is connected.
export async function lenderPartnerFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<{ key: string; partner: LenderPartner } | null> {
  if (LENDER_PARTNER !== "demo") return null;
  return (await adviceMode(userId, { client })) ? { key: "demo", partner: demoLender } : null;
}
