import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { booksSource } from "@/lib/jane-agent/sources/books";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { openBooks, runBooksCheck } from "./books";

// Spec step 238 against a real, migrated Postgres, with the demo bank plus one of each
// problem: a balance that's off, transactions that stopped, a stale link, a link that needs a
// sign-in, the same account linked twice (one pair proven alike and merged, one not and left),
// and a transfer with no other side. Each is caught, nothing is merged without proof, the
// figures are marked, and they clear when fixed.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe.runIf(url)("books that balance", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function addItem(status = "active", lastSyncedAt: Date | null = NOW) {
    return client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `test-${crypto.randomUUID()}`,
        accessTokenEncrypted: "x",
        institutionName: "Other Bank",
        status,
        lastSyncedAt,
      },
    });
  }
  async function addAccount(
    itemId: string | null,
    name: string,
    mask: string,
    over: { type?: string; subtype?: string } = {},
  ) {
    return client.account.create({
      data: {
        userId,
        itemId,
        source: "plaid",
        name,
        mask,
        type: over.type ?? "depository",
        subtype: over.subtype ?? "checking",
        currentBalanceCents: 100_000,
      },
    });
  }
  const txn = (
    accountId: string,
    date: string,
    amountCents: number,
    description: string,
    pfcPrimary: string | null = null,
  ) =>
    client.transaction.create({
      data: {
        userId,
        accountId,
        source: "plaid",
        date: day(date),
        amountCents,
        description,
        pfcPrimary,
      },
    });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `books-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    await client.booksIssue.deleteMany({ where: { userId } });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is clean for the demo bank on its own", async () => {
    const books = await runBooksCheck(userId, { client, now: NOW });
    expect(books.open.filter((o) => o.kind !== "transfer")).toEqual([]);
    expect(books.markedAccountIds).toEqual([]);
  });

  it("catches each problem, merges only the pair proven alike, and marks the figures", async () => {
    // A balance that's off, and transactions that stopped (gap).
    const off = await addAccount(null, "Off Checking", "1111");
    await client.balanceSnapshot.createMany({
      data: [
        { userId, accountId: off.id, date: day("2026-10-01"), balanceCents: 100_000 },
        { userId, accountId: off.id, date: day("2026-10-10"), balanceCents: 80_000 },
      ],
    });
    await txn(off.id, "2026-10-05", 12_000, "SHOP");
    const gap = await addAccount(null, "Gap Savings", "2222", { subtype: "savings" });
    await client.balanceSnapshot.createMany({
      data: [
        { userId, accountId: gap.id, date: day("2026-10-01"), balanceCents: 500_000 },
        { userId, accountId: gap.id, date: day("2026-10-10"), balanceCents: 450_000 },
      ],
    });
    // A stale link and a broken one.
    const stale = await addItem("active", day("2026-10-01"));
    const staleAccount = await addAccount(stale.id, "Stale Checking", "3333");
    const broken = await addItem("login_required", day("2026-10-02"));
    await addAccount(broken.id, "Broken Card", "4444", { type: "credit", subtype: "credit card" });
    // The same account linked twice: one pair identical (merged), one not (left).
    const first = await addItem();
    const keepA = await addAccount(first.id, "Real A", "5555");
    const second = await addItem();
    const dupA = await addAccount(second.id, "Real A copy", "5555");
    for (const [d, c, desc] of [
      ["2026-10-01", 500, "Coffee"],
      ["2026-10-03", 1_200, "Lunch"],
      ["2026-10-09", 900, "Gas"],
    ] as const) {
      await txn(keepA.id, d, c, desc);
      await txn(dupA.id, d, c, desc);
    }
    await txn(dupA.id, "2026-09-20", 700, "Older only on the copy");
    const keepB = await addAccount(first.id, "Real B", "6666", { subtype: "savings" });
    const dupB = await addAccount(second.id, "Real B copy", "6666", { subtype: "savings" });
    await txn(keepB.id, "2026-10-01", 500, "Coffee");
    await txn(dupB.id, "2026-10-01", 500, "Coffee");
    await txn(dupB.id, "2026-10-02", 4_000, "Rent");
    await txn(keepB.id, "2026-10-08", 100, "Fee");
    // A transfer with no other side.
    await txn(keepA.id, "2026-10-12", 150_000, "TO SOMEWHERE", "TRANSFER_OUT");

    const books = await runBooksCheck(userId, { client, now: NOW });
    expect(books.merged).toBe(1);
    const kinds = books.open.map((o) => o.kind).sort();
    expect(kinds).toEqual(["broken", "duplicate", "gap", "off", "stale", "transfer"]);
    // Proven alike: merged, the copy's older transaction moved across, the copy gone.
    expect(await client.account.count({ where: { id: dupA.id } })).toBe(0);
    expect(await client.transaction.count({ where: { accountId: keepA.id } })).toBe(5);
    expect(
      await client.transaction.findFirst({
        where: { accountId: keepA.id, description: "Older only on the copy" },
      }),
    ).not.toBeNull();
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "books_merged",
      { type: "account", id: keepA.id },
      expect.objectContaining({ moved: 1 }),
    );
    // Not proven: left alone, both still there, said in words.
    expect(await client.account.count({ where: { id: { in: [keepB.id, dupB.id] } } })).toBe(2);
    expect(books.open.find((o) => o.kind === "duplicate")!.words).toMatch(/haven't merged them/);
    // Figures that rely on these accounts are marked; the clean ones aren't.
    expect(new Set(books.markedAccountIds)).toEqual(
      new Set([
        off.id,
        gap.id,
        staleAccount.id,
        (await client.account.findFirstOrThrow({ where: { userId, mask: "4444" } })).id,
        dupB.id,
      ]),
    );
    expect(books.markedAccountIds).not.toContain(keepA.id);

    // The chat says it, once, and a broken link becomes one reconnect message.
    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    const said = gather(snapshot, NOW, { trigger: "open", sources: [booksSource] });
    expect(said.length).toBeGreaterThan(0);
    expect(said.length).toBeLessThanOrEqual(2);
    // Asked, she answers by the rules and Claude has the same.
    const answer = await answerByRules(userId, { kind: "books" }, { client, now: NOW });
    expect(answer?.body).toMatch(/^Not everything adds up yet\./);
    const tool = JSON.parse(
      (await runChatTool(userId, "books_check", {}, { client, now: NOW })).content,
    );
    expect(tool.allAddUp).toBe(false);
    expect(tool.problems.length).toBeGreaterThanOrEqual(5);

    // Fix them (the link works again, a snapshot agrees, the copy is deleted): they clear.
    await client.plaidItem.update({
      where: { id: broken.id },
      data: { status: "active", lastSyncedAt: NOW },
    });
    await client.plaidItem.update({ where: { id: stale.id }, data: { lastSyncedAt: NOW } });
    await client.balanceSnapshot.deleteMany({ where: { accountId: { in: [off.id, gap.id] } } });
    await client.account.delete({ where: { id: dupB.id } });
    await client.transaction.deleteMany({
      where: { accountId: keepA.id, pfcPrimary: "TRANSFER_OUT" },
    });
    const after = await runBooksCheck(userId, { client, now: NOW });
    expect(after.open).toEqual([]);
    expect((await openBooks(userId, { client })).markedAccountIds).toEqual([]);
    expect((await answerByRules(userId, { kind: "books" }, { client, now: NOW }))?.body).toMatch(
      /^Yes, as far as I can tell/,
    );
  });

  // Books QA: the Reyes' twice-linked savings was only in the harness's sample. The demo bank
  // now links it through a second login, and the real check finds it (and the others' one
  // login finds nothing): the copies are worded differently, so nothing is merged.
  it("finds the Reyes family's savings linked twice through two logins, live", async () => {
    const reyes = await client.user.create({
      data: { email: `books-reyes-${crypto.randomUUID()}@example.com` },
    });
    const maya = await client.user.create({
      data: { email: `books-maya-${crypto.randomUUID()}@example.com` },
    });
    created.push(reyes.id, maya.id);
    for (const [user, person] of [
      [reyes.id, "family"],
      [maya.id, "renter"],
    ] as const) {
      const { itemId } = await linkDemoBank(user, { client, now: NOW, person });
      await syncItem(itemId, { client, api, now: NOW });
    }
    expect(await client.plaidItem.count({ where: { userId: reyes.id } })).toBe(2);
    expect(await client.account.count({ where: { userId: reyes.id, mask: "2002" } })).toBe(2);

    const view = await runBooksCheck(reyes.id, { client, now: NOW });
    expect(view.merged).toBe(0);
    expect(view.open.filter((i) => i.kind === "duplicate")).toEqual([
      expect.objectContaining({
        words: expect.stringMatching(/^Demo Savings \(ending 2002\) .*linked twice/),
      }),
    ]);
    // A second sync of the demo bank doesn't link it a third time.
    const main = await client.plaidItem.findFirst({
      where: { userId: reyes.id, NOT: { plaidItemId: { endsWith: "-joint" } } },
    });
    await syncItem(main!.id, { client, api, now: NOW });
    expect(await client.plaidItem.count({ where: { userId: reyes.id } })).toBe(2);

    expect(await client.plaidItem.count({ where: { userId: maya.id } })).toBe(1);
    expect(
      (await runBooksCheck(maya.id, { client, now: NOW })).open.filter(
        (i) => i.kind === "duplicate",
      ),
    ).toEqual([]);
  });
});
