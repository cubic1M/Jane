import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import {
  accountsNotCounted,
  loadCounting,
  onlyCountedRows,
  reconcileLiabilities,
} from "@/lib/account-copies";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { lifeInput } from "@/lib/insurance/life";

// CodeRabbit on #2259: which of two uploads of one account counts goes by the day its statement
// ends (the upload's own last day, else its latest transaction), a tie by who was uploaded last; and
// the rows kept by account (liabilities here) follow the counted accounts, so an account linked
// twice does not set the life term from its copy.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-24T18:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.runIf(url)("what counts, against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const users: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `counted-rows-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    users.push(user.id);
    return user.id;
  }
  const upload = (userId: string, name: string, over: object = {}) =>
    client.account.create({
      data: {
        userId,
        source: "csv",
        name,
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 100_000,
        ...over,
      } as never,
    });
  const txOn = (userId: string, accountId: string, date: string, n: number) =>
    client.transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        date: day(date),
        amountCents: 500,
        description: `row ${n}`,
        dedupeKey: `k-${accountId}-${n}`,
      },
    });
  const run = (userId: string, accountId: string, toDate: string, createdAt: Date) =>
    client.importRun.create({
      data: { userId, accountId, rows: 1, toDate: day(toDate), stage: "done", createdAt },
    });
  const leftOut = async (userId: string) =>
    new Map(
      [...(await accountsNotCounted(scopedFor(userId, client)))].map(([id, v]) => [id, v.reason]),
    );

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("counts the statement that ends later, not the one with the later transaction", async () => {
    const userId = await person();
    const a = await upload(userId, "Chase checking");
    const b = await upload(userId, "Chase checking");
    // A's file runs to the end of October, though its last row is the 10th; B's last row is the 20th
    // but its file stops on the 15th.
    await txOn(userId, a.id, "2026-10-10", 1);
    await txOn(userId, b.id, "2026-10-20", 1);
    await run(userId, a.id, "2026-10-31", new Date("2026-11-01T10:00:00Z"));
    await run(userId, b.id, "2026-10-15", new Date("2026-11-02T10:00:00Z"));
    expect(await leftOut(userId)).toEqual(new Map([[b.id, "older_upload"]]));
  });

  it("falls back to the latest transaction when no upload was recorded", async () => {
    const userId = await person();
    const a = await upload(userId, "Chase checking");
    const b = await upload(userId, "Chase checking");
    await txOn(userId, a.id, "2026-10-10", 1);
    await txOn(userId, b.id, "2026-10-20", 1);
    expect(await leftOut(userId)).toEqual(new Map([[a.id, "older_upload"]]));
  });

  it("settles a tie on the end day by who was uploaded last", async () => {
    const userId = await person();
    const a = await upload(userId, "Chase checking");
    const b = await upload(userId, "Chase checking");
    await run(userId, a.id, "2026-10-31", new Date("2026-11-05T10:00:00Z"));
    await run(userId, b.id, "2026-10-31", new Date("2026-11-01T10:00:00Z"));
    expect(await leftOut(userId)).toEqual(new Map([[b.id, "older_upload"]]));
  });

  it("takes the tie-break time from the run that supplies the statement's end day", async () => {
    const userId = await person();
    const a = await upload(userId, "Chase checking");
    const b = await upload(userId, "Chase checking");
    // A's October statement was uploaded on 1 November; a September one was uploaded later, on the 5th.
    // B's October statement was uploaded on the 3rd: B is the later upload of the same end day.
    await run(userId, a.id, "2026-10-31", new Date("2026-11-01T10:00:00Z"));
    await run(userId, a.id, "2026-09-30", new Date("2026-11-05T10:00:00Z"));
    await run(userId, b.id, "2026-10-31", new Date("2026-11-03T10:00:00Z"));
    expect(await leftOut(userId)).toEqual(new Map([[a.id, "older_upload"]]));
  });

  it("keeps the interest a copy's link reported when the loan counts once", async () => {
    const userId = await person();
    const item = async (plaidItemId: string) =>
      (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId,
            accessTokenEncrypted: encrypt(`access-${plaidItemId}`),
            institutionName: "Chase",
            lastSyncedAt: NOW,
          },
        })
      ).id;
    const loan = async (itemId: string, plaidAccountId: string, interest: number | null) => {
      const account = await client.account.create({
        data: {
          userId,
          source: "plaid",
          itemId,
          plaidAccountId,
          name: "Mortgage",
          mask: "5555",
          type: "loan",
          subtype: "mortgage",
          currentBalanceCents: 20_000_000,
        } as never,
      });
      await client.liability.create({
        data: { userId, accountId: account.id, kind: "mortgage", ytdInterestPaidCents: interest },
      });
      return account;
    };
    const first = await loan(await item("item-int-1"), "int-1", null);
    await loan(await item("item-int-2"), "int-2", 123_400);
    const db = scopedFor(userId, client);
    const rows = await db.liabilities.findMany({
      select: { accountId: true, ytdInterestPaidCents: true },
    });
    const counted = reconcileLiabilities(await loadCounting(db), rows);
    expect(counted).toHaveLength(1);
    expect(counted[0]).toEqual({ accountId: first.id, ytdInterestPaidCents: 123_400 });
  });

  it("reads a liability of the account counted, not of its copy", async () => {
    const userId = await person();
    const mk = async (plaidItemId: string, institutionName: string) =>
      (
        await client.plaidItem.create({
          data: {
            userId,
            plaidItemId,
            accessTokenEncrypted: encrypt(`access-${plaidItemId}`),
            institutionName,
            lastSyncedAt: NOW,
          },
        })
      ).id;
    const [item1, item2] = [await mk("item-rows-1", "Chase"), await mk("item-rows-2", "Chase")];
    const mortgage = (itemId: string, plaidAccountId: string, payoff: string) =>
      client.account
        .create({
          data: {
            userId,
            source: "plaid",
            itemId,
            plaidAccountId,
            name: "Mortgage",
            mask: "9876",
            type: "loan",
            subtype: "mortgage",
            currentBalanceCents: 30_000_000,
          } as never,
        })
        .then(async (account) => {
          await client.liability.create({
            data: { userId, accountId: account.id, kind: "mortgage", payoffDate: day(payoff) },
          });
          return account;
        });
    const first = await mortgage(item1, "rows-1", "2036-01-01");
    const second = await mortgage(item2, "rows-2", "2056-01-01");
    const out = await leftOut(userId);
    expect(out.size).toBe(1);
    const copyId = [...out.keys()][0];
    expect([first.id, second.id]).toContain(copyId);
    const db = scopedFor(userId, client);
    expect(await onlyCountedRows(db)).toEqual({ accountId: { notIn: [copyId] } });
    // From 24 November 2026: a payoff in 2036 is 10 years away (rounded up), one in 2056 is 30.
    const keptYears = copyId === first.id ? 30 : 10;
    const { mortgageYearsLeft } = await lifeInput(userId, { client, now: NOW });
    expect(mortgageYearsLeft).toBe(keptYears);
  });
});
