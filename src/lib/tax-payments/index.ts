import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { demoTaxPaymentPartner } from "./demo";
import type { TaxPaymentPartner } from "./types";

// Which partner pays a person's estimated tax (spec step 223): the stand-in for people whose
// data is all the demo bank's (the same test as demo advice mode); nobody else until a real
// partner is connected (then add it here). Without one, the person pays at IRS Direct Pay
// and tells Jane.
export async function taxPaymentPartnerFor(
  userId: string,
  { client }: { client?: PrismaClient } = {},
): Promise<TaxPaymentPartner | null> {
  return (await adviceMode(userId, { client })) ? demoTaxPaymentPartner : null;
}

export type { TaxPaymentPartner } from "./types";
