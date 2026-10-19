import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { demoFilingPartner } from "./demo";
import type { FilingPartner } from "./types";

// Which filing partner a person files with (spec step 126): the stand-in for people whose
// data is all the demo bank's (the same test as demo advice mode); nobody else until a real
// partner is connected (then add it here).
export async function filingPartnerFor(
  userId: string,
  { client }: { client?: PrismaClient } = {},
): Promise<FilingPartner | null> {
  return (await adviceMode(userId, { client })) ? demoFilingPartner : null;
}

export type { FilingPartner, ReturnPackage, ReturnPreview } from "./types";
