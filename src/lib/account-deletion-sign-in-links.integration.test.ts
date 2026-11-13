import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { deleteAllData } from "./account-deletion";

// Debugger 11-13, a new student's walk to "Delete all my data": the account went, but a sign-in
// link from the sign-up form (its email never sent) kept the address in verification_tokens for
// the rest of its hour. /privacy says everything goes.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("deleting an account", () => {
  let client: PrismaClient;
  const api = { itemRemove: vi.fn() } as unknown as PlaidApi;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.$disconnect();
  });

  it("takes the sign-in links still waiting for its address", async () => {
    const email = `links-${crypto.randomUUID()}@example.com`;
    const user = await client.user.create({ data: { email } });
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await client.verificationToken.createMany({
      data: [
        { identifier: email, token: `t1-${crypto.randomUUID()}`, expires },
        { identifier: email.toUpperCase(), token: `t2-${crypto.randomUUID()}`, expires },
      ],
    });
    // Someone else's link stays.
    const other = `other-${crypto.randomUUID()}@example.com`;
    await client.verificationToken.create({
      data: { identifier: other, token: `t3-${crypto.randomUUID()}`, expires },
    });

    await deleteAllData(user.id, { client, api });

    expect(
      await client.verificationToken.count({
        where: { identifier: { equals: email, mode: "insensitive" } },
      }),
    ).toBe(0);
    expect(await client.verificationToken.count({ where: { identifier: other } })).toBe(1);
    await client.verificationToken.deleteMany({ where: { identifier: other } });
  });
});
