import { connectorsOn } from "@/config/connectors";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { akoyaPartner, sandboxAkoyaPartner } from "@/lib/connectors/akoya/partner";
import { ConsentError, consentCovers, usableConnector } from "@/lib/connectors/consent";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { demoDocumentPartner } from "./demo";
import type { TaxDocumentPartner } from "./types";

// Which document partner collects a person's tax forms (spec step 166). With connectors on (never
// in production yet): Akoya for a person who allowed it (src/lib/connectors/akoya/), the real one
// for real data and its sandbox twin for sample data. Otherwise the stand-in for people whose data
// is all the demo bank's (the same test as demo advice mode), and nobody else.
export async function documentPartnerFor(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<TaxDocumentPartner | null> {
  if (connectorsOn()) {
    if (await allowed(userId, "akoya_tax", client)) {
      return akoyaPartner({ lastAccess: await lastAccess(userId, client) });
    }
    if (await allowed(userId, "sandbox_akoya_tax", client)) return sandboxAkoyaPartner;
  }
  return (await adviceMode(userId, { client })) ? demoDocumentPartner : null;
}

// Usable for this person now, and their consent covers it.
async function allowed(userId: string, connectorId: string, client: PrismaClient) {
  try {
    const connector = await usableConnector(userId, connectorId, { client });
    return await consentCovers(userId, connector, { client });
  } catch (error) {
    if (error instanceof ConsentError) return false;
    throw error;
  }
}

// When the person last used Jane, which Akoya asks for on every data call.
async function lastAccess(userId: string, client: PrismaClient): Promise<Date> {
  const row = await scopedFor(userId, client).sessions.findFirst({
    select: { lastSeenAt: true, createdAt: true },
    orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return row?.lastSeenAt ?? row?.createdAt ?? new Date();
}

export type { TaxDocumentPartner } from "./types";
