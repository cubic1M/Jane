import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { encrypt } from "@/lib/crypto";
import { runBooksCheck } from "./books";
import { loadNetWorthInputs } from "./net-worth-history";

// The founder's Home, 11-23 ("not my current net worth"): Chase checking uploaded from a statement,
// then linked. Net worth counted the upload's last balance and left the link out, and the books
// check, finding the two alike, merged the link into the upload and deleted it, which the next sync
// made again. Now the link is the one counted, nothing is deleted, and the notice says which copy
// is counted.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-23T18:00:00Z");

describe.runIf(url)("an account uploaded, then linked", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let uploadId: string;
  let linkedId: string;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: {
          email: `books-upload-and-link-${Date.now().toString(36)}@example.com`,
          timezone: "America/Los_Angeles",
        },
      })
    ).id;
    // Uploaded first: its statement ended Oct 31 at $1,200.00.
    uploadId = (
      await client.account.create({
        data: {
          userId,
          source: "csv",
          name: "Chase checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          currentBalanceCents: 120_000,
        },
      })
    ).id;
    const { id: itemId } = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: "item-upload-and-link",
        accessTokenEncrypted: encrypt("access-upload-and-link"),
        institutionName: "Chase",
        lastSyncedAt: NOW,
      },
    });
    // Linked later: $4,850.00 today.
    linkedId = (
      await client.account.create({
        data: {
          userId,
          itemId,
          source: "plaid",
          plaidAccountId: "upload-and-link",
          name: "TOTAL CHECKING",
          mask: "1234",
          type: "depository",
          subtype: "checking",
          currentBalanceCents: 485_000,
        },
      })
    ).id;
    // A $2,000.00 transfer out on both copies (the same line twice) to a savings account that got
    // it once, and a September line only the statement has: the link starts on Oct 3.
    const savingsId = (
      await client.account.create({
        data: {
          userId,
          source: "csv",
          name: "Savings",
          mask: "9876",
          type: "depository",
          subtype: "savings",
          currentBalanceCents: 200_000,
        },
      })
    ).id;
    await client.transaction.createMany({
      data: [
        ...[uploadId, linkedId].map((accountId, a) => ({
          userId,
          accountId,
          source: a === 0 ? ("csv" as const) : ("plaid" as const),
          ...(a === 0 ? { dedupeKey: "up-transfer" } : { plaidTransactionId: "pl-transfer" }),
          date: new Date("2026-10-20T00:00:00Z"),
          amountCents: 200_000,
          description: "TRANSFER TO SAVINGS",
          pfcPrimary: "TRANSFER_OUT",
          pending: false,
        })),
        {
          userId,
          accountId: savingsId,
          source: "csv" as const,
          dedupeKey: "sv-transfer",
          date: new Date("2026-10-21T00:00:00Z"),
          amountCents: -200_000,
          description: "TRANSFER FROM CHECKING",
          pfcPrimary: "TRANSFER_IN",
          pending: false,
        },
        {
          userId,
          accountId: uploadId,
          source: "csv" as const,
          dedupeKey: "up-sept",
          date: new Date("2026-09-20T00:00:00Z"),
          amountCents: 3_100,
          description: "SAFEWAY STORE",
          pending: false,
        },
      ],
    });
    // The same October on both, so the two copies match transaction for transaction.
    const october = [
      ["2026-10-03", 4_210, "SAFEWAY STORE"],
      ["2026-10-15", 6_500, "VERIZON WIRELESS"],
      ["2026-10-29", -62_000, "UNIV OF CALIF PAYROLL"],
    ] as const;
    await client.transaction.createMany({
      data: [uploadId, linkedId].flatMap((accountId, a) =>
        october.map(([date, amountCents, description], i) => ({
          userId,
          accountId,
          source: a === 0 ? ("csv" as const) : ("plaid" as const),
          ...(a === 0 ? { dedupeKey: `up-${i}` } : { plaidTransactionId: `pl-${i}` }),
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description,
          pending: false,
        })),
      ),
    });
  });
  afterAll(async () => {
    // userId is unset when the setup failed: an undefined id would match every person.
    try {
      if (userId) await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await client.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  it("counts the linked balance, keeps both copies, and says the statement is left out", async () => {
    const books = await runBooksCheck(userId, { client, now: NOW });
    const left = await client.account.findMany({ where: { userId }, select: { id: true } });
    expect(left).toHaveLength(3);
    expect(left.map((a) => a.id)).toEqual(expect.arrayContaining([uploadId, linkedId]));
    const words = JSON.stringify(books);
    expect(words).toContain(
      "Chase checking (ending 1234) is a statement you uploaded of TOTAL CHECKING, which you've since linked. I count the linked one",
    );
    // What leaving the statement out stops counting is said: its one September line.
    expect(words).toContain(
      "Its 1 line from Sep 20, 2026 to Sep 20, 2026, before the link's first day",
    );
    // The statement's copy of the transfer isn't matched again: the one transfer has its deposit.
    expect(books.open.map((i) => i.kind)).not.toContain("transfer");
    // The statement kept beside its link is not also "an old import": its file ended months ago.
    expect(books.open.filter((i) => i.accountId === uploadId).map((i) => i.kind)).toEqual([
      "duplicate",
    ]);
    const { worth } = await loadNetWorthInputs(userId, { client });
    expect(worth.netCents).toBe(485_000 + 200_000);
  });
});
