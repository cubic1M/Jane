import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { scopedFor } from "@/lib/db-scoped";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { realPerson, removePeople } from "./__fixtures__/people";
import { deleteCredential, storeCredential } from "./vault";

// Accounts read through a connector (Method's loans and cards, SnapTrade's brokerage accounts) go
// with the person's connection: revoking it deletes its credential, and the accounts with it, the
// way a Robinhood disconnect takes its accounts. Against a real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("accounts read through a connector", () => {
  let client: PrismaClient;
  let person: string;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    person = await realPerson(client);
  });
  afterAll(async () => {
    await removePeople(client, [person]);
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("go when the connection they came through is revoked, and nothing else does", async () => {
    await storeCredential(person, "method_liabilities", "ent_test_entity", { client });
    const db = scopedFor(person, client);
    const credential = await db.connectorCredentials.findFirstOrThrow({
      where: { connectorId: "method_liabilities" },
      select: { id: true },
    });
    await db.accounts.create({
      data: {
        userId: person,
        source: "method",
        connectorCredentialId: credential.id,
        externalAccountId: "acc_test_card",
        name: "Card ending 1580",
        type: "credit",
        subtype: "credit card",
      },
    });
    const own = await db.accounts.create({
      data: { userId: person, source: "csv", name: "Checking", type: "depository" },
    });
    // The same account from the same connection can't be saved twice.
    await expect(
      db.accounts.create({
        data: {
          userId: person,
          source: "method",
          connectorCredentialId: credential.id,
          externalAccountId: "acc_test_card",
          name: "Card ending 1580",
          type: "credit",
        },
      }),
    ).rejects.toThrow();

    expect(await deleteCredential(person, "method_liabilities", { client })).toBe(true);
    const left = await db.accounts.findMany({ select: { id: true, source: true } });
    expect(left).toEqual([{ id: own.id, source: "csv" }]);
  });
});
