import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import type { ReadResult } from "../types";
import type { SnaptradeRead } from "./normalize";

// Saves what SnapTrade read as the person's investment accounts (source "snaptrade") and their
// holdings, tied to their connection so revoking it takes them back (accounts.connector_credential_id
// cascades, and holdings go with their account). A re-read updates each account in place by
// SnapTrade's id and replaces its holdings; an account SnapTrade no longer reports is removed.

const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export async function saveSnaptradeReads(
  userId: string,
  credentialId: string,
  reads: readonly SnaptradeRead[],
  { client }: { client: PrismaClient },
): Promise<ReadResult> {
  let positions = 0;
  // One change: a failure partway leaves the previous complete snapshot, never a new balance
  // beside old or half-replaced holdings.
  await scopedFor(userId, client).transaction(async (tx) => {
    for (const read of reads) {
      const key = { connectorCredentialId: credentialId, externalAccountId: read.externalId };
      const account = await tx.accounts.upsert({
        where: { connectorCredentialId_externalAccountId: key },
        create: { ...key, userId, source: "snaptrade", ...read.account },
        update: read.account,
        select: { id: true },
      });
      const asOf = day(read.asOf);
      const kept: string[] = [];
      for (const h of read.holdings) {
        const security = {
          name: h.name,
          ticker: h.ticker,
          type: h.type,
          subtype: h.subtype,
          isCashEquivalent: h.isCashEquivalent,
          closePriceCents: h.priceCents,
          closePriceAsOf: asOf,
        };
        // A security saved before holdings were keyed by SnapTrade's instrument id was keyed by
        // ticker: it takes the new key (and keeps its holdings and history) the first time it is
        // read again, unless the new key already exists.
        if (
          !(await tx.securities.findFirst({
            where: { plaidSecurityId: h.ref },
            select: { id: true },
          }))
        ) {
          await tx.securities.updateMany({
            where: { plaidSecurityId: h.tickerRef },
            data: { plaidSecurityId: h.ref },
          });
        }
        const { id: securityId } = await tx.securities.upsert({
          where: { userId_plaidSecurityId: { userId, plaidSecurityId: h.ref } },
          create: { userId, plaidSecurityId: h.ref, ...security },
          update: security,
          select: { id: true },
        });
        const holding = {
          quantity: h.quantity,
          priceCents: h.priceCents,
          priceAsOf: asOf,
          valueCents: h.valueCents,
          costBasisCents: h.costBasisCents,
        };
        await tx.holdings.upsert({
          where: { accountId_securityId: { accountId: account.id, securityId } },
          create: { userId, accountId: account.id, securityId, ...holding },
          update: holding,
        });
        kept.push(securityId);
      }
      await tx.holdings.deleteMany({
        where: { accountId: account.id, securityId: { notIn: kept } },
      });
      positions += kept.length;
    }
    await tx.accounts.deleteMany({
      where: {
        connectorCredentialId: credentialId,
        externalAccountId: { notIn: reads.map((r) => r.externalId) },
      },
    });
  });
  const n = reads.length;
  return {
    saved: positions,
    note:
      n === 0
        ? "No investment accounts found at that brokerage."
        : `${positions} ${positions === 1 ? "holding" : "holdings"} from ${n} ${n === 1 ? "account" : "accounts"} added to your investments.`,
  };
}
