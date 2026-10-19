import type { PlaidApi } from "plaid";
import type { PrismaClient } from "@/generated/prisma/client";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// The person Jane's answer checks talk to (spec step 87): a new account with the demo bank
// linked and synced, so every run asks over the same kind of data. Never a real person;
// deleted after the run.

// The demo bank never calls Plaid; anything that tried would fail here.
const NO_PLAID = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("The demo bank must never call Plaid");
    },
  },
) as PlaidApi;

export async function createCheckPerson({
  client,
  now,
}: {
  client: PrismaClient;
  now: Date;
}): Promise<string> {
  const user = await client.user.create({
    data: { email: `answer-checks-${crypto.randomUUID()}@example.com` },
  });
  const { itemId } = await linkDemoBank(user.id, { client, now });
  await syncItem(itemId, { client, api: NO_PLAID, now });
  return user.id;
}

export async function deleteCheckPerson(userId: string, { client }: { client: PrismaClient }) {
  await client.user.deleteMany({ where: { id: userId, email: { startsWith: "answer-checks-" } } });
}
