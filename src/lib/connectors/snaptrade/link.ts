import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { consentCovers, usableConnector } from "../consent";
import { ReadRefused } from "../read";
import { NoCredential, storeCredential, withCredential } from "../vault";
import { snaptradeHttp, type SnaptradeApi } from "./api";
import { snaptradeHoldings, userOf } from "./connector";

// SnapTrade's Connection Portal link, for a person who may use the real connector now (its locks:
// off for everyone until REAL_CONNECTORS) and whose consent covers it. Registers their SnapTrade user
// the first time, under an id Jane makes up, and keeps it in the vault with that id as the link's ref;
// then asks SnapTrade for a read-only connection. Not wired to a page yet.

export async function snaptradeConnectLink(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    api = snaptradeHttp(),
  }: { client?: PrismaClient; now?: Date; api?: SnaptradeApi } = {},
): Promise<string> {
  // Throws ConsentError with why it isn't available (off, switched off, trial, sample data).
  const connector = await usableConnector(userId, snaptradeHoldings.id, { client });
  if (!(await consentCovers(userId, connector, { client }))) throw new ReadRefused("no_consent");
  const user = await withCredential(userId, connector.id, async (s) => userOf(s), {
    client,
    now,
  }).catch(async (error: unknown) => {
    if (!(error instanceof NoCredential)) throw error;
    const created = await api.registerUser(randomUUID());
    await storeCredential(userId, connector.id, JSON.stringify(created), {
      client,
      linkRef: created.userId,
    });
    return created;
  });
  return api.connectLink(user);
}
