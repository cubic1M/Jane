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

export async function removePeople(client: PrismaClient, ids: readonly string[]): Promise<void> {
  await systemDb(WHY, client).user.deleteMany({ where: { id: { in: [...ids] } } });
}
