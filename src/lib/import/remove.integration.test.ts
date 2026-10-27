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

import { finishImport } from "./background";
import { listUploads, removeUpload, removeUploadedAccount, startOver } from "./remove";
import { saveUpload } from "./upload";
import { logAudit } from "@/lib/audit";
import { scopedFor } from "@/lib/db-scoped";

// Taking uploads back against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

const pad = (n: number) => String(n).padStart(2, "0");
const us = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
const day = (n: number) => new Date(Date.UTC(2026, 6, 1) + n * 86_400_000);

// Chase card rows for days [from, to): a monthly Netflix and a weekly fee-free lunch.
function card(from: number, to: number): string {
  const lines = ["Transaction Date,Post Date,Description,Category,Type,Amount,Memo"];
  for (let d = from; d < to; d++) {
    if (day(d).getUTCDate() === 3) {
      lines.push(`${us(day(d))},${us(day(d))},NETFLIX.COM,Entertainment,Sale,-22.99,`);
    }
    if (d % 7 === 0)
      lines.push(`${us(day(d))},${us(day(d))},CORNER CAFE,Food & Drink,Sale,-11.50,`);
  }
  return lines.join("\n");
}

function form(fields: Record<string, string>, name: string, text: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("files", new File([text], name, { type: "text/csv" }));
  return data;
}

describe.runIf(url)("taking uploads back, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const make = async (who: string) =>
      (
        await client.user.create({
          data: { email: `remove-${who}-${crypto.randomUUID()}@example.com` },
        })
      ).id;
    userId = await make("me");
    otherId = await make("other");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await client.$disconnect();
  });

  it("removes exactly the rows an upload added, and the findings go with them", async () => {
    const db = scopedFor(userId, client);
    const first = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Card", "new.kind": "credit_card", "new.balance": "100" },
        "jul-sep.csv",
        card(0, 92),
      ),
    );
    if (!first.ok) throw new Error(first.error);
    // A second file overlapping the first by a month: only its new rows are its own.
    const second = await saveUpload(
      db,
      form({ accountId: first.accountId }, "sep-oct.csv", card(62, 118)),
    );
    if (!second.ok) throw new Error(second.error);
    await finishImport(userId, second.runId, { client, now: NOW });
    const before = await client.transaction.count({ where: { userId } });

    const { uploads } = await listUploads(db);
    expect(uploads.map((u) => [u.fileNames, u.rows])).toEqual([
      [["sep-oct.csv"], second.counts.inserted],
      [["jul-sep.csv"], first.counts.inserted],
    ]);
    expect(await client.finding.count({ where: { userId, key: { contains: "netflix" } } })).toBe(1);

    const removed = await removeUpload(db, first.runId);
    expect(removed).toMatchObject({ rows: first.counts.inserted, accounts: 0 });
    expect(await client.transaction.count({ where: { userId } })).toBe(
      before - first.counts.inserted,
    );
    expect(await client.transaction.count({ where: { userId, importRunId: second.runId } })).toBe(
      second.counts.inserted,
    );
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: userId }, "upload_removed", null, {
      rows: first.counts.inserted,
      accounts: 0,
    });

    // Then everything goes: the findings and the total drop.
    await removeUpload(db, second.runId);
    const refresh = await client.importRun.findFirstOrThrow({
      where: { userId, kind: "removal" },
      orderBy: { createdAt: "desc" },
    });
    await finishImport(userId, refresh.id, { client, now: NOW });
    expect(await client.transaction.count({ where: { userId } })).toBe(0);
    expect(
      await client.finding.count({ where: { userId, status: { in: ["new", "shown"] } } }),
    ).toBe(0);
    expect(await client.importRun.findUniqueOrThrow({ where: { id: refresh.id } })).toMatchObject({
      stage: "done",
      foundCents: 0,
    });
  });

  it("never touches another person's uploads", async () => {
    const theirs = await saveUpload(
      scopedFor(otherId, client),
      form(
        { accountId: "new", "new.name": "Theirs", "new.kind": "credit_card" },
        "t.csv",
        card(0, 30),
      ),
    );
    if (!theirs.ok) throw new Error(theirs.error);
    const mine = scopedFor(userId, client);
    expect(await removeUpload(mine, theirs.runId)).toBeNull();
    expect(await removeUploadedAccount(mine, theirs.accountId)).toBeNull();
    expect(await client.transaction.count({ where: { userId: otherId } })).toBe(
      theirs.counts.inserted,
    );
  });

  it("removes an uploaded account with everything in it, but never a linked bank's", async () => {
    const db = scopedFor(userId, client);
    const up = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Old card", "new.kind": "credit_card" },
        "o.csv",
        card(0, 40),
      ),
    );
    if (!up.ok) throw new Error(up.error);
    const item = await client.plaidItem.create({
      data: { userId, plaidItemId: `item-${crypto.randomUUID()}`, accessTokenEncrypted: "x" },
    });
    const linked = await client.account.create({
      data: { userId, source: "plaid", itemId: item.id, name: "Linked", type: "depository" },
    });

    expect(await removeUploadedAccount(db, linked.id)).toBeNull();
    expect(await removeUploadedAccount(db, up.accountId)).toMatchObject({ accounts: 1 });
    expect(await client.account.findUnique({ where: { id: up.accountId } })).toBeNull();
    expect(await client.importRun.count({ where: { accountId: up.accountId } })).toBe(0);

    // Start over: every uploaded account goes; the linked bank stays.
    await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "A", "new.kind": "checking", "new.balance": "5" },
        "a.csv",
        card(0, 10),
      ),
    );
    const uploaded = await client.account.count({ where: { userId, source: "csv" } });
    expect(uploaded).toBeGreaterThan(0);
    const reset = await startOver(db);
    expect(reset).toMatchObject({ accounts: uploaded });
    expect(await client.account.findMany({ where: { userId }, select: { id: true } })).toEqual([
      { id: linked.id },
    ]);
    expect(await startOver(db)).toBeNull();
  });
});
