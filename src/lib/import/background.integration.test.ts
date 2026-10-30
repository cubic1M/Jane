import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
// The card text and Jane's chat message are their own jobs' business (and call Claude).
vi.mock("@/lib/jobs", () => ({
  enqueueJob: vi.fn(async () => "job_1"),
  runJob: vi.fn(async () => "done"),
}));
vi.mock("@/lib/jane-agent/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jane-agent/run")>()),
  runJaneAgentSafely: vi.fn(),
}));

import { currentImportRun, dismissImportRun, finishImport } from "./background";
import { saveUpload } from "./upload";
import { scopedFor } from "@/lib/db-scoped";
import { loadNetWorthHistory } from "@/lib/net-worth-history";

// An upload through to "done" against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts): rows saved at once, then the background job.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

const pad = (n: number) => String(n).padStart(2, "0");
const us = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
const day = (offset: number) => new Date(Date.UTC(2026, 6, 1) + offset * 86_400_000);

// Three months of Chase checking with its running balance: pay twice a month, rent, Netflix
// and groceries. Newest first, as Chase exports it.
function checkingFile(): string {
  const rows: [string, string, number][] = [];
  for (let d = 0; d < 118; d++) {
    const date = day(d);
    const dom = date.getUTCDate();
    if (dom === 1 || dom === 15) rows.push([us(date), "ACME CORP PAYROLL PPD ID: 98765", 240000]);
    if (dom === 2) rows.push([us(date), "OAKWOOD APTS RENT PAYMENT", -185000]);
    if (dom === 3) rows.push([us(date), "NETFLIX.COM NETFLIX.COM CA", -1549]);
    if (dom % 4 === 0) rows.push([us(date), "WHOLEFDS MKT 10234", -6420]);
  }
  let balance = 300000;
  const lines = rows.map(([date, description, cents]) => {
    balance += cents;
    const kind = cents > 0 ? "CREDIT" : "DEBIT";
    return `${kind},${date},"${description}",${(cents / 100).toFixed(2)},ACH,${(balance / 100).toFixed(2)},,`;
  });
  return [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    ...lines.reverse(),
  ].join("\n");
}

// Three months of a Chase card: no balance column, so it's worked back from what's owed today.
function cardFile(): string {
  const lines = ["Transaction Date,Post Date,Description,Category,Type,Amount,Memo"];
  for (let d = 0; d < 118; d += 3) {
    lines.push(
      `${us(day(d))},${us(day(d))},UBER   *TRIP,Travel,Sale,-${(12 + (d % 7)).toFixed(2)},`,
    );
  }
  lines.push(`${us(day(80))},${us(day(80))},Payment Thank You-Mobile,,Payment,400.00,`);
  return lines.join("\n");
}

function form(fields: Record<string, string>, name: string, text: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("files", new File([text], name, { type: "text/csv" }));
  return data;
}

describe.runIf(url)("an upload finished in the background, against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `background-import-${crypto.randomUUID()}@example.com` },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("saves at once, then works out card payments, balances, findings and the scan", async () => {
    const db = scopedFor(userId, client);
    const checking = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Chase checking", "new.kind": "checking" },
        "checking.csv",
        checkingFile(),
      ),
    );
    if (!checking.ok) throw new Error(checking.error);
    // Saved, not yet worked out.
    expect(await currentImportRun(userId, { client, now: NOW })).toMatchObject({
      id: checking.runId,
      stage: "queued",
    });
    // No balance typed: the statement's latest running balance is today's.
    const account = await client.account.findUniqueOrThrow({ where: { id: checking.accountId } });
    expect(account.currentBalanceCents).not.toBeNull();

    const card = await saveUpload(
      db,
      form(
        {
          accountId: "new",
          "new.name": "Chase card",
          "new.kind": "credit_card",
          "new.balance": "350.00",
        },
        "card.csv",
        cardFile(),
      ),
    );
    if (!card.ok) throw new Error(card.error);

    await finishImport(userId, checking.runId, { client, now: NOW });
    await finishImport(userId, card.runId, { client, now: NOW });

    const run = await currentImportRun(userId, { client, now: NOW });
    expect(run).toMatchObject({ id: card.runId, stage: "done", percent: 100 });
    expect(run?.foundCents).toEqual(expect.any(Number));
    // Closing the newest chip closes it for good: the first file's run (and its older figure)
    // never comes back in its place (night QA 10-30).
    await dismissImportRun(userId, card.runId, { client, now: NOW });
    expect(await currentImportRun(userId, { client, now: NOW })).toBeNull();

    // The statement's own balances for checking; month ends worked back for the card.
    const sources = await client.balanceSnapshot.groupBy({
      by: ["accountId", "source"],
      where: { userId },
      _count: true,
    });
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: checking.accountId, source: "file" }),
        expect.objectContaining({ accountId: card.accountId, source: "derived" }),
      ]),
    );

    // The scan is over for the person, as after a bank sync.
    const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.firstDetectionAt).not.toBeNull();
    expect(user.firstScanDoneAt).not.toBeNull();
  });

  it("draws net worth that moves over the months and ends at today's balances", async () => {
    const history = await loadNetWorthHistory(userId, { client, now: NOW });
    expect(history).not.toBeNull();
    const accounts = await client.account.findMany({ where: { userId } });
    const today = accounts.reduce(
      (sum, a) => sum + (a.type === "credit" ? -1 : 1) * (a.currentBalanceCents ?? 0),
      0,
    );
    expect(history!.todayCents).toBe(today);
    const shown = history!.months.flatMap((m) => (m.netCents === null ? [] : [m.netCents]));
    expect(shown.at(-1)).toBe(today);
    // Not a flat line: the months before differ from today.
    expect(new Set(shown).size).toBeGreaterThan(1);
  });
});
