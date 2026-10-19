import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { demoDocumentPartner } from "./demo";
import type { TaxDocumentPartner } from "./types";

// Which document partner collects a person's tax forms (spec step 166): the stand-in for
// people whose data is all the demo bank's (the same test as demo advice mode); nobody else
// until a real partner is connected (then add it here).
export async function documentPartnerFor(
  userId: string,
  { client }: { client?: PrismaClient } = {},
): Promise<TaxDocumentPartner | null> {
  return (await adviceMode(userId, { client })) ? demoDocumentPartner : null;
}

export type { FetchedForm, TaxDocumentPartner } from "./types";
