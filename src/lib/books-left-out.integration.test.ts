import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { openBooks } from "@/lib/books";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { keepAccountSeparate } from "@/lib/import/separate";

// A books line stored while an account was counted must not be shown once it is left out, even
// before the next check has marked it fixed (review of #2289).

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("books lines about an account since left out", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string | undefined;
  const ids = { upload: "", savings: "", link: "" };

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `books-left-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { id: itemId } = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt("access"),
        institutionName: "Wells Fargo",
      },
    });
    const account = async (data: object) =>
      (
        await client.account.create({
          data: {
            userId: userId!,
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 100_000,
            ...data,
          } as never,
        })
      ).id;
    // An upload with no last four beside the linked checking: left out. The savings upload is not.
    ids.upload = await account({ source: "csv", name: "Wells Fargo checking" });
    ids.savings = await account({ source: "csv", name: "Wells Fargo savings", subtype: "savings" });
    ids.link = await account({
      source: "plaid",
      itemId,
      plaidAccountId: `pa-${crypto.randomUUID()}`,
      name: "Everyday Checking",
      mask: "4321",
    });
    const stored: [string, string, string][] = [
      ["gap", "balance:upload", ids.upload],
      ["stale", "import:upload", ids.upload],
      ["transfer", "transfer:upload", ids.upload],
      ["duplicate", "dup:upload", ids.upload],
      ["off", "balance:savings", ids.savings],
    ];
    for (const [kind, key, accountId] of stored)
      await client.booksIssue.create({
        data: { userId, key, kind, accountId, detail: { words: key } },
      });
  });
  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const said = async () => {
    const books = await openBooks(userId!, { client });
    return { words: books.open.map((i) => i.words).sort(), marked: books.markedAccountIds.sort() };
  };

  it("shows and marks only what is about a counted account, and keeps the duplicate line", async () => {
    expect(await said()).toEqual({
      words: ["balance:savings", "dup:upload"],
      // The duplicate line marks its own account, as before; the gap no longer does.
      marked: [ids.savings, ids.upload].sort(),
    });
    await client.booksIssue.deleteMany({ where: { userId, kind: "duplicate" } });
    expect(await said()).toEqual({ words: ["balance:savings"], marked: [ids.savings] });
  });

  it("shows them again once the account is counted", async () => {
    expect(await keepAccountSeparate(scopedFor(userId!, client), ids.upload)).toBe(true);
    expect((await said()).words).toEqual([
      "balance:savings",
      "balance:upload",
      "import:upload",
      "transfer:upload",
    ]);
  });
});
