import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import type { ReadResult } from "../types";
import type { MethodRead } from "./normalize";

// Saves what Method read as the person's accounts and liabilities (source "method"), tied to their
// connection so revoking it takes them back (accounts.connector_credential_id cascades). A re-read
// updates each account in place by Method's id; one Method no longer reports is removed.

const at = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export async function saveMethodReads(
  userId: string,
  credentialId: string,
  reads: readonly MethodRead[],
  { client }: { client: PrismaClient },
): Promise<ReadResult> {
  const db = scopedFor(userId, client);
  for (const read of reads) {
    const key = { connectorCredentialId: credentialId, externalAccountId: read.externalId };
    const account = await db.accounts.upsert({
      where: { connectorCredentialId_externalAccountId: key },
      create: { ...key, userId, source: "method", ...read.account },
      update: read.account,
      select: { id: true },
    });
    const l = read.liability;
    const row = {
      kind: l.kind,
      aprBps: l.aprBps,
      rateType: l.rateType,
      minimumPaymentCents: l.minimumPaymentCents,
      nextPaymentDueDate: at(l.nextPaymentDueDate),
      lastPaymentCents: l.lastPaymentCents,
      lastPaymentDate: at(l.lastPaymentDate),
      originationPrincipalCents: l.originationPrincipalCents,
      originationDate: at(l.originationDate),
      payoffDate: at(l.payoffDate),
      loanTermMonths: l.loanTermMonths,
      description: l.description,
    };
    await db.liabilities.upsert({
      where: { accountId: account.id },
      create: { ...row, userId, accountId: account.id },
      update: row,
    });
  }
  await db.accounts.deleteMany({
    where: {
      connectorCredentialId: credentialId,
      externalAccountId: { notIn: reads.map((r) => r.externalId) },
    },
  });
  const n = reads.length;
  return {
    saved: n,
    note:
      n === 0
        ? "No loans or cards found on your credit report."
        : `${n} ${n === 1 ? "loan or card" : "loans and cards"} from your credit report added to your debts.`,
  };
}
