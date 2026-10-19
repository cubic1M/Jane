import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { demoDonorFund } from "./demo";
import type { DonorFundPartner } from "./types";

// Which donor-advised fund partner a person can open with (spec step 168): the stand-in
// in demo advice mode; nobody else until a real partner is connected.
export async function donorFundPartnerFor(
  userId: string,
  { client }: { client?: PrismaClient } = {},
): Promise<DonorFundPartner | null> {
  return (await adviceMode(userId, { client })) ? demoDonorFund : null;
}

export type { DonorFundPartner } from "./types";
