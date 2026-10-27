import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({
  enqueueJob: vi.fn(async () => "job_1"),
  runJob: vi.fn(async () => "done"),
}));
vi.mock("@/lib/jane-agent/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jane-agent/run")>()),
  runJaneAgentSafely: vi.fn(),
}));

import { balancesToAsk, setUploadedBalance } from "./account-balance";
import { finishImport } from "./background";
import { saveUpload } from "./upload";
import { notCounting } from "@/insights/net-worth";
import { logAudit } from "@/lib/audit";
import { scopedFor } from "@/lib/db-scoped";
import { accountsWithoutBalance, loadNetWorthHistory } from "@/lib/net-worth-history";

// A card file without a balance, against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts): Jane asks for it, and until then net worth says what
// it isn't counting.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

const card = [
  "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
  "10/01/2026,10/02/2026,UBER   *TRIP,Travel,Sale,-24.00,",
  "10/10/2026,10/11/2026,WHOLEFDS MKT 10234,Groceries,Sale,-80.00,",
].join("\n");
const checking = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  "DEBIT,10/20/2026,MONTHLY SERVICE FEE,-12.00,FEE_TRANSACTION,1988.00,,",
  "CREDIT,10/15/2026,ACME CORP PAYROLL PPD,2000.00,ACH_CREDIT,2000.00,,",
].join("\n");

function form(fields: Record<string, string>, name: string, text: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("files", new File([text], name, { type: "text/csv" }));
  return data;
}

describe.runIf(url)("asking for an uploaded card's balance, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const make = async (who: string) =>
      (
        await client.user.create({
          data: { email: `balance-${who}-${crypto.randomUUID()}@example.com` },
        })
      ).id;
    userId = await make("me");
    otherId = await make("other");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await client.$disconnect();
  });

  it("asks only for the account whose file had no balance, then counts it", async () => {
    const db = scopedFor(userId, client);
    const bank = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Chase checking", "new.kind": "checking" },
        "c.csv",
        checking,
      ),
    );
    const cardUpload = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Chase card", "new.kind": "credit_card" },
        "k.csv",
        card,
      ),
    );
    if (!bank.ok || !cardUpload.ok) throw new Error("upload failed");

    // The checking file's running balance gave its balance; the card's file had none.
    expect(await balancesToAsk(db)).toEqual([
      { accountId: cardUpload.accountId, name: "Chase card", kind: "credit_card" },
    ]);
    expect(await accountsWithoutBalance(userId, { client })).toEqual(["Chase card"]);
    expect(notCounting(await accountsWithoutBalance(userId, { client }))?.sentence).toBe(
      "Not counting Chase card: there's no balance yet.",
    );

    const set = await setUploadedBalance(db, cardUpload.accountId, 35000);
    expect(set).toEqual({ jobId: "job_1" });
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: userId }, "uploaded_balance_set", {
      type: "account",
      id: cardUpload.accountId,
    });
    // The numbers are worked out again, shown by the chip as an update.
    const run = await client.importRun.findFirstOrThrow({ where: { userId, kind: "update" } });
    await finishImport(userId, run.id, { client, now: NOW });

    expect(await balancesToAsk(db)).toEqual([]);
    const history = await loadNetWorthHistory(userId, { client, now: NOW });
    // $1,988.00 in checking, $350.00 owed on the card.
    expect(history?.todayCents).toBe(198800 - 35000);
  });

  it("never sets another person's, or a linked bank's, balance", async () => {
    const theirs = await saveUpload(
      scopedFor(otherId, client),
      form({ accountId: "new", "new.name": "Theirs", "new.kind": "credit_card" }, "t.csv", card),
    );
    if (!theirs.ok) throw new Error(theirs.error);
    expect(await setUploadedBalance(scopedFor(userId, client), theirs.accountId, 100)).toBeNull();
    const item = await client.plaidItem.create({
      data: { userId, plaidItemId: `item-${crypto.randomUUID()}`, accessTokenEncrypted: "x" },
    });
    const linked = await client.account.create({
      data: { userId, source: "plaid", itemId: item.id, name: "Linked", type: "credit" },
    });
    expect(await setUploadedBalance(scopedFor(userId, client), linked.id, 100)).toBeNull();
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: theirs.accountId } }))
        .currentBalanceCents,
    ).toBeNull();
  });
});
