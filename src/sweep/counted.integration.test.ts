import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The surfaces read the default client: the test database here.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PrismaClient } from "@/generated/prisma/client";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { runBooksCheck } from "@/lib/books";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { loadMoneyHub } from "@/lib/hubs/money";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { loadNetWorthHistory, loadNetWorthInputs } from "@/lib/net-worth-history";
import { accountsNotCounted, leftOutNotes, uploadsClearedByEvidence } from "@/lib/account-copies";
import { maybeSamePair } from "@/insights/net-worth";
import { EVERYONE, makePerson, type OwnRows } from "./__fixtures__/people";
import { atLocal } from "./diff";
import { countingProblems, historyProblems, noticeProblems } from "./counted";

// Class 12 over real rows (the founder, 11-24): for every sweep person, and one person per way an
// account got in twice, what net worth counts holds each account once (./counted.ts), and Home's
// figure, the Money page, the Money hub and the net worth chart all say the same number. The shapes
// each read about twice the truth on main.

const url = process.env.TEST_DATABASE_URL;
const ZONE = "America/Los_Angeles";
const DAY = "2026-11-12";
const NOW = atLocal(DAY, 15, ZONE);

describe.runIf(url)("what net worth counts holds each account once", { timeout: 600_000 }, () => {
  let client: PrismaClient;
  const own = (): OwnRows => ({
    person: (data) => client.user.create({ data }),
    item: (id, data) => client.plaidItem.update({ where: { id }, data }),
  });

  beforeAll(() => {
    stubTestKeys();
    vi.stubEnv("SYNC_SNAPSHOTS", "off");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await client.user.deleteMany({ where: { email: { startsWith: "counted-" } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  // What net worth counts for a person, the way a figure reads it, with each account's bank.
  async function problemsOf(userId: string) {
    const db = scopedFor(userId, client);
    const [{ accounts }, items, said] = await Promise.all([
      loadNetWorthInputs(userId, { client }),
      db.plaidItems.findMany({ select: { id: true, institutionName: true } }),
      db.janePreferences.findMany({ where: { kind: "separate" }, select: { key: true } }),
    ]);
    const cleared = await uploadsClearedByEvidence(db);
    const all = await db.accounts.findMany({ select: { id: true, source: true } });
    const source = new Map(all.map((a) => [a.id, a.source]));
    const bank = new Map(items.map((i) => [i.id, i.institutionName]));
    const [left, notes, inputs, history] = await Promise.all([
      accountsNotCounted(db),
      leftOutNotes(db),
      loadNetWorthInputs(userId, { client }),
      loadNetWorthHistory(userId, { client, now: NOW }),
    ]);
    return [
      ...countingProblems(
        accounts.map((a) => ({ ...a, source: source.get(a.id) ?? null })),
        (a) => (a.itemId ? (bank.get(a.itemId) ?? null) : null),
        new Set(said.map((p) => p.key.replace("account:", ""))),
        cleared,
      ),
      ...noticeProblems(
        new Set(accounts.map((a) => a.id)),
        notes.map((n) => ({
          leftId: n.id,
          withId: left.get(n.id)!.sameAs.id,
          words: maybeSamePair(n),
        })),
      ),
      // Things owned count from the first balance too, so the accounts' days are enough.
      ...historyProblems(
        history?.months ?? [],
        inputs.snapshots.map((s) => s.date),
      ),
    ];
  }

  // The one figure, as every surface reads it.
  async function figures(userId: string) {
    const [inputs, history, area, hub] = await Promise.all([
      loadNetWorthInputs(userId, { client }),
      loadNetWorthHistory(userId, { client, now: NOW }),
      loadMoneyArea(userId, { client, now: NOW }),
      loadMoneyHub(userId, { client, now: NOW }),
    ]);
    return [
      inputs.worth.netCents,
      history?.todayCents ?? null,
      area.have.netCents,
      hub.netWorth.netCents,
    ];
  }

  it("holds for every sweep person, and every surface says the same net worth", async () => {
    const lines: string[] = [];
    for (const who of EVERYONE) {
      const { userId } = await makePerson(client, own(), who, {
        linked: NOW,
        seed: `counted-${who}`,
        email: `counted-${who}@example.test`,
        timezone: ZONE,
      });
      for (const line of await problemsOf(userId)) lines.push(`${who}: ${line}`);
      const [first, ...rest] = await figures(userId);
      for (const other of rest)
        if (other !== null && other !== first) lines.push(`${who}: ${first} vs ${other}`);
      await client.user.delete({ where: { id: userId } });
    }
    expect(lines).toEqual([]);
  });

  // One person per way an account got in twice: linked balances plus the uploads that can't be a
  // copy of one, and nothing twice.
  const SHAPES: {
    name: string;
    accounts: (itemId: string) => object[];
    // What net worth is: the linked balances plus the uploads proven distinct.
    netCents: number;
  }[] = [
    {
      name: "an upload with no last four, then the account linked",
      accounts: (itemId) => [
        { source: "csv", name: "Wells Fargo checking", mask: null, currentBalanceCents: 120_000 },
        {
          source: "plaid",
          itemId,
          name: "Everyday Checking",
          mask: "4321",
          currentBalanceCents: 485_000,
        },
      ],
      netCents: 485_000,
    },
    {
      name: "an upload with the last four, the link naming the subtype another way",
      accounts: (itemId) => [
        { source: "csv", name: "Wells Fargo checking", mask: "4321", currentBalanceCents: 120_000 },
        {
          source: "plaid",
          itemId,
          name: "Everyday Checking",
          mask: "4321",
          subtype: "cash management",
          currentBalanceCents: 485_000,
        },
      ],
      netCents: 485_000,
    },
    {
      name: "the same statement uploaded twice as two accounts (the later one counts)",
      accounts: () => [
        { source: "csv", name: "Wells Fargo checking", mask: "4321", currentBalanceCents: 100_000 },
        {
          source: "csv",
          name: "Wells Fargo checking 2",
          mask: "4321",
          currentBalanceCents: 130_000,
        },
      ],
      netCents: 130_000,
    },
    {
      name: "a linked account and uploads that are other accounts: all counted",
      accounts: (itemId) => [
        {
          source: "plaid",
          itemId,
          name: "Everyday Checking",
          mask: "4321",
          currentBalanceCents: 485_000,
        },
        {
          source: "csv",
          name: "Wells Fargo savings",
          subtype: "savings",
          mask: null,
          currentBalanceCents: 20_000,
        },
        { source: "csv", name: "Wells Fargo checking", mask: "9876", currentBalanceCents: 30_000 },
        { source: "csv", name: "Chase checking", mask: null, currentBalanceCents: 40_000 },
      ],
      netCents: 485_000 + 20_000 + 30_000 + 40_000,
    },
  ];

  for (const shape of SHAPES) {
    it(`${shape.name}: net worth is the linked balances plus what is proven distinct`, async () => {
      const user = await client.user.create({
        data: {
          email: `counted-shape-${Math.random().toString(36).slice(2, 8)}@example.test`,
          timezone: ZONE,
        },
      });
      const { id: itemId } = await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `item-${user.id}`,
          accessTokenEncrypted: encrypt("access-counted"),
          institutionName: "Wells Fargo",
          lastSyncedAt: NOW,
        },
      });
      let n = 0;
      for (const data of shape.accounts(itemId)) {
        n += 1;
        await client.account.create({
          data: {
            userId: user.id,
            type: "depository",
            subtype: "checking",
            plaidAccountId: `plaid-${user.id}-${n}`,
            ...data,
          } as never,
        });
      }
      expect(await problemsOf(user.id)).toEqual([]);
      const figs = await figures(user.id);
      expect(new Set(figs)).toEqual(new Set([shape.netCents]));
      // The books check names nothing it would have to merge: it left them out, said.
      await runBooksCheck(user.id, { client, now: NOW });
    });
  }
});
