import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import {
  plaidAccount,
  plaidApiError,
  plaidTransaction,
  syncPage,
} from "@/data-sources/plaid/__fixtures__/plaid";
import { encrypt } from "@/lib/crypto";
import { latestNotes } from "./history";
import { syncItem } from "./sync";

// Runs against a real, migrated Postgres (see sync.integration.test.ts), with Plaid's API mocked.
// What the one read from the start leaves behind: the rows Plaid dropped since the last ordinary
// sync must go (Jane matches Plaid), and nothing else.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-27T12:00:00Z");
const LATER = new Date("2026-11-27T13:00:00Z");
const LINKED = new Date("2026-11-10T12:00:00Z");

describe.runIf(url)("a read from the start: what Plaid dropped is removed", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID().replace(/\d/g, "x");
  const transactionsSync = vi.fn();
  const api = {
    accountsGet: vi.fn(async () => ({ data: { accounts: [] } })),
    transactionsSync,
    transactionsRecurringGet: vi.fn(async () => ({
      data: { outflow_streams: [], inflow_streams: [] },
    })),
  } as unknown as PlaidApi;
  const created: string[] = [];

  type Link = { userId: string; itemId: string; acc: string };
  async function link(name: string): Promise<Link> {
    const userId = (
      await client.user.create({ data: { email: `reread-${name}-${suffix}@example.com` } })
    ).id;
    const itemId = (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `item-${name}-${suffix}`,
          accessTokenEncrypted: encrypt("access-sandbox-reread"),
          institutionName: "Slow Platypus Bank",
          createdAt: LINKED,
        },
      })
    ).id;
    created.push(userId);
    return { userId, itemId, acc: `${name}-${suffix}-acc` };
  }
  const account = (l: Link) => plaidAccount({ account_id: l.acc });
  const tx = (l: Link, id: string, date: string, amount = 12.34) => ({
    ...plaidTransaction({ transaction_id: `${l.acc}-${id}`, date, amount }),
    account_id: l.acc,
  });
  const recent = (l: Link) =>
    ["2026-10-19", "2026-10-29", "2026-11-08"].map((d, i) => tx(l, `r${i}`, d));
  const older = (l: Link) =>
    Array.from({ length: 10 }, (_, i) =>
      tx(l, `o${i}`, `2025-${String(i + 1).padStart(2, "0")}-15`, 20 + i),
    );
  const held = (l: Link) => client.transaction.count({ where: { account: { itemId: l.itemId } } });
  const heldIds = async (l: Link) =>
    (
      await client.transaction.findMany({
        where: { account: { itemId: l.itemId }, source: "plaid" },
      })
    ).map((t) => t.plaidTransactionId!.replace(`${l.acc}-`, ""));
  const cursorOf = async (l: Link) =>
    (await client.plaidItem.findUniqueOrThrow({ where: { id: l.itemId } })).transactionsCursor;
  const page = (l: Link, added: unknown[], cursor: string) =>
    syncPage({ accounts: [account(l)], added: added as never, next_cursor: cursor });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.opsEvent.deleteMany({ where: { kind: "plaid_reread_held" } });
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    transactionsSync.mockReset();
  });

  // A first sync that holds only the recent days (as the link did), then the bank changes its mind.
  async function firstSync(l: Link, extra: unknown[]) {
    transactionsSync.mockResolvedValueOnce(page(l, [...recent(l), ...extra], "c1"));
    await syncItem(l.itemId, { client, api, now: NOW });
  }

  it("a hold that vanished and a charge reissued under a new id: Jane holds what Plaid lists, and the next sync keeps it", async () => {
    const l = await link("walk");
    const hold = { ...tx(l, "hold", "2026-11-09"), pending: true };
    await firstSync(l, [hold, tx(l, "old-id", "2026-11-07")]);
    expect(await held(l)).toBe(5);
    transactionsSync.mockResolvedValueOnce(
      page(l, [...recent(l), ...older(l), tx(l, "new-id", "2026-11-07")], "c2"),
    );
    await syncItem(l.itemId, { client, api, now: LATER });
    expect(transactionsSync.mock.calls[1][0].cursor).toBeUndefined();
    // Plaid lists 14.
    expect(await held(l)).toBe(14);
    const ids = await heldIds(l);
    expect(ids).not.toContain("hold");
    expect(ids).not.toContain("old-id");
    expect(ids).toContain("new-id");
    expect(await cursorOf(l)).toBe("c2");
    transactionsSync.mockResolvedValueOnce(page(l, [], "c2"));
    await syncItem(l.itemId, { client, api, now: new Date("2026-11-28T12:00:00Z") });
    expect(await held(l)).toBe(14);
  });

  it("a reissued charge takes the category the person set on the old one", async () => {
    const l = await link("carry");
    await firstSync(l, [tx(l, "old-id", "2026-11-07")]);
    await client.transaction.updateMany({
      where: { plaidTransactionId: `${l.acc}-old-id` },
      data: {
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_OTHER",
        categorySource: "user",
      },
    });
    transactionsSync.mockResolvedValueOnce(
      page(l, [...recent(l), ...older(l), tx(l, "new-id", "2026-11-07")], "c2"),
    );
    await syncItem(l.itemId, { client, api, now: LATER });
    expect(await heldIds(l)).not.toContain("old-id");
    expect(
      await client.transaction.findFirstOrThrow({
        where: { plaidTransactionId: `${l.acc}-new-id` },
      }),
    ).toMatchObject({ pfcPrimary: "ENTERTAINMENT", categorySource: "user" });
  });

  it("an edited posted row with no counterpart stays, with its edit", async () => {
    const l = await link("keep");
    await firstSync(l, [tx(l, "lone", "2026-11-07", 99.99)]);
    await client.transaction.updateMany({
      where: { plaidTransactionId: `${l.acc}-lone` },
      data: {
        pfcPrimary: "ENTERTAINMENT",
        pfcDetailed: "ENTERTAINMENT_OTHER",
        categorySource: "user",
      },
    });
    transactionsSync.mockResolvedValueOnce(page(l, [...recent(l), ...older(l)], "c2"));
    await syncItem(l.itemId, { client, api, now: LATER });
    expect(await heldIds(l)).toContain("lone");
  });

  it("leaves a statement row on the same account and another link's rows alone", async () => {
    const l = await link("mine");
    const other = await link("other");
    await firstSync(l, [tx(l, "gone", "2026-11-07")]);
    transactionsSync.mockResolvedValueOnce(page(other, [tx(other, "o1", "2026-11-01")], "x1"));
    await syncItem(other.itemId, { client, api, now: NOW });
    const mine = await client.account.findFirstOrThrow({ where: { itemId: l.itemId } });
    await client.transaction.create({
      data: {
        userId: l.userId,
        accountId: mine.id,
        source: "csv",
        dedupeKey: "statement-row",
        date: new Date("2026-11-02T00:00:00Z"),
        amountCents: 555,
        description: "From a statement",
      },
    });
    transactionsSync.mockResolvedValueOnce(page(l, [...recent(l), ...older(l)], "c2"));
    await syncItem(l.itemId, { client, api, now: LATER });
    expect(await heldIds(l)).not.toContain("gone");
    expect(await client.transaction.count({ where: { accountId: mine.id, source: "csv" } })).toBe(
      1,
    );
    expect(await held(other)).toBe(1);
    expect(await cursorOf(other)).toBe("x1");
  });

  it("holds back a removal of too many posted rows: nothing removed, cursor kept, flagged, not tried again", async () => {
    const l = await link("cap");
    const many = Array.from({ length: 8 }, (_, i) => tx(l, `m${i}`, "2026-11-05", 30 + i));
    await firstSync(l, many);
    expect(await held(l)).toBe(11);
    await client.opsEvent.deleteMany({ where: { kind: "plaid_reread_held" } });
    transactionsSync.mockResolvedValueOnce(page(l, [...recent(l), ...older(l)], "c2"));
    await syncItem(l.itemId, { client, api, now: LATER });
    // Everything the person had is still there, and the saved cursor was not moved.
    expect(await heldIds(l)).toEqual(
      expect.arrayContaining(many.map((m) => m.transaction_id.replace(`${l.acc}-`, ""))),
    );
    expect(await cursorOf(l)).toBe("c1");
    expect(await client.opsEvent.count({ where: { kind: "plaid_reread_held" } })).toBe(1);
    const note = (await latestNotes([l.itemId], { client })).get(l.itemId)!;
    expect(note.rereadHeld).toBe("8 posted of 21 rows");
    expect(note.rescannedAt).toBe(LATER.toISOString());
    // Tomorrow's sync goes on from the saved cursor: the removals Plaid lists then are applied.
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account(l)],
        removed: many.map((m) => ({ transaction_id: m.transaction_id, account_id: l.acc })),
        next_cursor: "c3",
      }),
    );
    await syncItem(l.itemId, { client, api, now: new Date("2026-11-28T12:00:00Z") });
    expect(transactionsSync.mock.calls[2][0].cursor).toBe("c1");
    expect(await held(l)).toBe(13);
  });

  it("a read from the start that fails part-way changes nothing", async () => {
    const l = await link("partial");
    await firstSync(l, [tx(l, "gone", "2026-11-07")]);
    transactionsSync
      .mockResolvedValueOnce(
        syncPage({
          accounts: [account(l)],
          added: older(l) as never,
          next_cursor: "p1",
          has_more: true,
        }),
      )
      .mockRejectedValueOnce(plaidApiError("INTERNAL_SERVER_ERROR", 400))
      .mockResolvedValueOnce(page(l, [], "c1"));
    await syncItem(l.itemId, { client, api, now: LATER }).catch(() => undefined);
    expect(await heldIds(l)).toContain("gone");
    expect(await cursorOf(l)).toBe("c1");
    expect(await held(l)).toBe(4);
  });

  it("a read from the start that lists nothing removes nothing, and one that is not ready keeps the cursor and tries again", async () => {
    const l = await link("empty");
    await firstSync(l, [tx(l, "x", "2026-11-07", 9)]);
    transactionsSync.mockResolvedValueOnce(
      syncPage({ accounts: [account(l)], next_cursor: "", status: "NOT_READY" }),
    );
    await syncItem(l.itemId, { client, api, now: LATER });
    expect(await held(l)).toBe(4);
    expect(await cursorOf(l)).toBe("c1");
    expect((await latestNotes([l.itemId], { client })).get(l.itemId)!.rescannedAt).toBeNull();
    transactionsSync.mockResolvedValueOnce(page(l, [], "c2"));
    await syncItem(l.itemId, { client, api, now: new Date("2026-11-28T12:00:00Z") });
    expect(transactionsSync.mock.calls[2][0].cursor).toBeUndefined();
    expect(await held(l)).toBe(4);
  });

  it("rows older than the earliest day the read lists are outside it: kept, and not counted toward the cap", async () => {
    const l = await link("window");
    await client.opsEvent.deleteMany({ where: { kind: "plaid_reread_held" } });
    const old = Array.from({ length: 8 }, (_, i) => tx(l, `y${i}`, "2023-06-15", 50 + i));
    await firstSync(l, old);
    transactionsSync.mockResolvedValueOnce(page(l, [...recent(l), ...older(l)], "c2"));
    await syncItem(l.itemId, { client, api, now: LATER });
    const ids = await heldIds(l);
    for (let i = 0; i < 8; i++) expect(ids).toContain(`y${i}`);
    // Not held back: the read finished and moved the cursor.
    expect(await cursorOf(l)).toBe("c2");
    expect(await client.opsEvent.count({ where: { kind: "plaid_reread_held" } })).toBe(0);
  });

  it("an account the read lists nothing for is untouched", async () => {
    const l = await link("twoacc");
    const acc2 = `${l.acc}-two`;
    const other = { ...tx(l, "b1", "2026-11-03", 5), account_id: acc2 };
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account(l), plaidAccount({ account_id: acc2 })],
        added: [...recent(l), other] as never,
        next_cursor: "c1",
      }),
    );
    await syncItem(l.itemId, { client, api, now: NOW });
    expect(await held(l)).toBe(4);
    transactionsSync.mockResolvedValueOnce(
      syncPage({
        accounts: [account(l), plaidAccount({ account_id: acc2 })],
        added: [...recent(l), ...older(l)] as never,
        next_cursor: "c2",
      }),
    );
    await syncItem(l.itemId, { client, api, now: LATER });
    expect(await heldIds(l)).toContain("b1");
  });

  it("net worth and the real balances are the same to the cent; only the worked-back past moves", async () => {
    const l = await link("money");
    const hold = { ...tx(l, "hold", "2026-11-09", 40), pending: true };
    await firstSync(l, [hold, tx(l, "old-id", "2026-11-07", 70)]);
    const snaps = () =>
      client.balanceSnapshot.findMany({
        where: { account: { itemId: l.itemId } },
        orderBy: [{ date: "asc" }],
      });
    const real = (rows: Awaited<ReturnType<typeof snaps>>) =>
      rows.filter((s) => s.source === null).map((s) => [s.date.toISOString(), s.balanceCents]);
    const balances = () =>
      client.account.findMany({
        where: { itemId: l.itemId },
        select: { currentBalanceCents: true },
      });
    const before = { real: real(await snaps()), balances: await balances(), past: await snaps() };
    transactionsSync.mockResolvedValueOnce(
      page(l, [...recent(l), ...older(l), tx(l, "new-id", "2026-11-07", 70)], "c2"),
    );
    await syncItem(l.itemId, { client, api, now: LATER });
    const after = { real: real(await snaps()), balances: await balances(), past: await snaps() };
    expect(after.real).toEqual(before.real);
    expect(after.balances).toEqual(before.balances);
    // The past is worked back from the transactions each sync, so the duplicate 70.00 and the dropped
    // 40.00 hold no longer pull it: the corrected rows are the ones Plaid lists.
    expect(after.past.length).toBeGreaterThanOrEqual(before.past.length);
    // Had the old id stayed beside the new one, every worked-back day before 7 Nov would sit 70.00
    // lower (the charge counted twice). With it removed the day before is what it was.
    const on = (rows: typeof after.past, day: string) =>
      rows.find((r) => r.date.toISOString().startsWith(day) && r.source !== null)?.balanceCents;
    expect(on(after.past, "2026-11-06")).toBe(131690);
    expect(on(after.past, "2026-11-06")).toBe(on(before.past, "2026-11-06"));
  });
});
