import type { PrismaClient } from "@/generated/prisma/client";
import { systemDb } from "@/lib/system-db";

// People for the connectors' integration tests: a real account (a bank that isn't the demo), a
// sample-data person (the demo bank only) and a trial person. Rows only: no sync runs.

const WHY = "Test: makes people for the connector tests";

async function make(client: PrismaClient, id: string | undefined, demo: boolean | null) {
  const user = await systemDb(WHY, client).user.create({
    data: { ...(id ? { id } : {}), email: `connectors-${crypto.randomUUID()}@example.com` },
  });
  if (demo !== null) {
    await systemDb(WHY, client).plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `${demo ? "demo-" : "real-"}${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1.not.a.token",
      },
    });
  }
  return user.id;
}

export const realPerson = (client: PrismaClient) => make(client, undefined, false);
export const samplePerson = (client: PrismaClient) => make(client, undefined, true);
export const trialPerson = (client: PrismaClient) =>
  make(client, `trial_${crypto.randomUUID()}`, null);

// A sample-data person who sent money to a brokerage, so the investing card ("You put $X into
// investing") and its SnapTrade tap reach them. The demo people send none and stay as they are: their
// figures hold the accuracy baselines (manager, 11-19). Two transfers to Robinhood inside the card's
// three months before `now`.
export async function sampleInvestor(client: PrismaClient, now = new Date()): Promise<string> {
  const id = await samplePerson(client);
  const account = await systemDb(WHY, client).account.create({
    data: { userId: id, source: "plaid", name: "Checking", type: "depository" },
  });
  await systemDb(WHY, client).transaction.createMany({
    data: [12, 40].map((days) => ({
      userId: id,
      accountId: account.id,
      source: "plaid" as const,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)),
      amountCents: 25_000,
      description: "ROBINHOOD DES:FUNDS",
      merchantName: "Robinhood",
      pfcDetailed: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    })),
  });
  return id;
}

export async function removePeople(client: PrismaClient, ids: readonly string[]): Promise<void> {
  await systemDb(WHY, client).user.deleteMany({ where: { id: { in: [...ids] } } });
}
