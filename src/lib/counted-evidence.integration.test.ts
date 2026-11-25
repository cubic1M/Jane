import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { accountsNotCounted, uploadsClearedByEvidence } from "@/lib/account-copies";
import { runBooksCheck } from "@/lib/books";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { loadMaybeSame, loadNetWorthInputs } from "@/lib/net-worth-history";

// The founder's rule, automatic (11-25): an upload beside a linked account of the same bank and kind
// is compared with it, by the lines both show and the closing balance, and Jane decides: the same
// account is left out, a different one is counted, and with nothing to compare Plaid wins.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-24T18:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const AMOUNTS = [1250, 4599, 899, 12000, 3300, 760, 2500, 18000, 450, 6100, 999, 1500];
const OTHER = [333, 777, 1234, 4321, 555, 8080, 909, 1111, 2222, 3333, 4444, 5555];
const dateOf = (i: number) => new Date(Date.UTC(2026, 8, 1 + i * 7)).toISOString().slice(0, 10);

describe.runIf(url)("an upload beside a linked account, compared", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const users: string[] = [];

  async function shape(upload: {
    amounts: number[];
    shiftDays?: number;
    balance?: number;
    // The link's lines are still pending, each a tip above what the statement will say.
    linkPending?: boolean;
  }) {
    const user = await client.user.create({
      data: { email: `evidence-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    users.push(user.id);
    const userId = user.id;
    const item = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `item-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt("access"),
        institutionName: "Chase",
        lastSyncedAt: NOW,
      },
    });
    const link = await client.account.create({
      data: {
        userId,
        source: "plaid",
        itemId: item.id,
        plaidAccountId: `pa-${crypto.randomUUID()}`,
        name: "TOTAL CHECKING",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 485_000,
      } as never,
    });
    const up = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Chase checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: upload.balance ?? 120_000,
      },
    });
    await client.transaction.createMany({
      data: AMOUNTS.map((amountCents, i) => ({
        userId,
        accountId: link.id,
        source: "plaid" as const,
        plaidTransactionId: `pt-${crypto.randomUUID()}`,
        pending: upload.linkPending ?? false,
        date: day(dateOf(i)),
        amountCents: upload.linkPending ? amountCents + 300 : amountCents,
        description: `LINE ${i}`,
        categorySource: "rule" as const,
      })),
    });
    await client.transaction.createMany({
      data: upload.amounts.map((amountCents, i) => ({
        userId,
        accountId: up.id,
        source: "csv" as const,
        dedupeKey: crypto.randomUUID(),
        date: day(dateOf(i + (upload.shiftDays ?? 0))),
        amountCents,
        description: `ROW ${i}`,
        categorySource: "rule" as const,
      })),
    });
    // The link's own history reaches the statement's last day.
    await client.balanceSnapshot.create({
      data: {
        userId,
        accountId: link.id,
        date: day(dateOf(upload.amounts.length - 1)),
        balanceCents: 120_000,
      },
    });
    return { userId, link, upload: up };
  }

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("the same lines: the same account, left out, and nothing asked", async () => {
    const { userId, link, upload } = await shape({ amounts: AMOUNTS });
    const db = scopedFor(userId, client);
    const left = await accountsNotCounted(db);
    expect(left.get(upload.id)).toMatchObject({ reason: "same_account", sameAs: { id: link.id } });
    expect((await loadNetWorthInputs(userId, { client })).worth.netCents).toBe(485_000);
    const said = await loadMaybeSame(userId, { client });
    expect(said?.words).toBe(
      "Chase checking (uploaded) shows the same activity as TOTAL CHECKING (linked), so Jane left it out of net worth.",
    );
    const books = await runBooksCheck(userId, { client, now: NOW });
    expect(books.open.map((i) => i.kind)).not.toContain("maybe_same");
  });

  it("different lines over the same days: a different account, counted, and nothing asked", async () => {
    const { userId, upload } = await shape({ amounts: OTHER });
    const db = scopedFor(userId, client);
    expect((await accountsNotCounted(db)).size).toBe(0);
    expect(await uploadsClearedByEvidence(db)).toEqual(new Set([upload.id]));
    expect((await loadNetWorthInputs(userId, { client })).worth.netCents).toBe(485_000 + 120_000);
    expect(await loadMaybeSame(userId, { client })).toBeNull();
    const books = await runBooksCheck(userId, { client, now: NOW });
    expect(books.open.map((i) => i.kind)).not.toContain("maybe_same");
  });

  it("nothing to compare: Plaid wins, left out, and the line says it could not be compared", async () => {
    const { userId, upload } = await shape({ amounts: [] });
    const left = await accountsNotCounted(scopedFor(userId, client));
    expect(left.get(upload.id)?.reason).toBe("maybe_same");
    expect((await loadNetWorthInputs(userId, { client })).worth.netCents).toBe(485_000);
    expect((await loadMaybeSame(userId, { client }))?.words).toMatch(/nothing to compare/);
  });

  it("days that don't overlap: nothing to compare either", async () => {
    const { userId, upload } = await shape({ amounts: AMOUNTS.slice(0, 6), shiftDays: 30 });
    const left = await accountsNotCounted(scopedFor(userId, client));
    expect(left.get(upload.id)?.reason).toBe("maybe_same");
  });

  it("a closing balance equal to the link's that day settles a short statement", async () => {
    const { userId, upload } = await shape({ amounts: AMOUNTS.slice(0, 3), balance: 120_000 });
    const left = await accountsNotCounted(scopedFor(userId, client));
    expect(left.get(upload.id)?.reason).toBe("same_account");
    expect((await loadNetWorthInputs(userId, { client })).worth.netCents).toBe(485_000);
  });

  it("pending charges on the link don't make a different account of the same one", async () => {
    const { userId, upload } = await shape({
      amounts: AMOUNTS,
      linkPending: true,
      balance: 50_000,
    });
    const left = await accountsNotCounted(scopedFor(userId, client));
    // Nothing posted to compare yet: left out as not compared, never counted.
    expect(left.get(upload.id)?.reason).toBe("maybe_same");
    expect((await loadNetWorthInputs(userId, { client })).worth.netCents).toBe(485_000);
  });
});
