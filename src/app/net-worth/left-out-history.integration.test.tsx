import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Debug 2, sweep 22 (11-26), on the founder's shape (two linked accounts and three look-alike
// uploads): Net worth listed April to October at today's figure, months only the uploads left out
// had balances for; and an upload was said to be passed over for a later one that "Jane counted",
// which was left out too. The books box and Money also listed those handled copies as data in doubt.

const who = vi.hoisted(() => ({ id: "", email: "nw-history@example.test" }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: async () => who }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }));
vi.mock("@/components/asset-prompts", () => ({ AssetPrompts: () => null }));
vi.mock("@/components/books-notice", () => ({ BooksNotice: () => null }));
vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => children,
}));

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { maybeSamePair } from "@/insights/net-worth";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { accountsNotCounted, leftOutNotes } from "@/lib/account-copies";
import { openBooks, runBooksCheck } from "@/lib/books";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { monthLabel } from "@/lib/day-label";
import NetWorthPage from "./page";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-24T18:00:00Z");
const TODAY = "2026-11-24";
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// `count` lines a week apart from a first day, with amounts of their own.
const lines = (first: string, count: number, base: number) =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(day(first).getTime() + i * 7 * 86_400_000),
    amountCents: base + i * 137,
  }));

describe.runIf(url)("net worth's history and notices follow what is counted", () => {
  let client: PrismaClient;
  const users: string[] = [];

  type Made = {
    name: string;
    linked?: boolean;
    subtype?: string;
    balance: number;
    txns?: { date: Date; amountCents: number }[];
    // The days it has a balance on.
    on?: string[];
  };
  async function person(accounts: Made[]) {
    const user = await client.user.create({
      data: { email: `nw-history-${crypto.randomUUID()}@example.test`, timezone: "UTC" },
    });
    users.push(user.id);
    const item = await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `item-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt("access"),
        institutionName: "Chase",
        lastSyncedAt: NOW,
      },
    });
    const ids = new Map<string, string>();
    for (const a of accounts) {
      const account = await client.account.create({
        data: {
          userId: user.id,
          name: a.name,
          type: "depository",
          subtype: a.subtype ?? "checking",
          currentBalanceCents: a.balance,
          ...(a.linked
            ? { source: "plaid", itemId: item.id, plaidAccountId: `pa-${crypto.randomUUID()}` }
            : { source: "csv" }),
        },
      });
      ids.set(a.name, account.id);
      await client.transaction.createMany({
        data: (a.txns ?? []).map((t) => ({
          ...t,
          userId: user.id,
          accountId: account.id,
          description: "LINE",
          source: a.linked ? ("plaid" as const) : ("csv" as const),
          dedupeKey: crypto.randomUUID(),
        })),
      });
      await client.balanceSnapshot.createMany({
        data: (a.on ?? [TODAY]).map((d) => ({
          userId: user.id,
          accountId: account.id,
          date: day(d),
          balanceCents: a.balance,
          source: a.linked ? "plaid" : "file",
        })),
      });
    }
    who.id = user.id;
    return { userId: user.id, ids };
  }

  async function page() {
    const shell = NetWorthPage() as ReactElement<{ children: ReactElement }>;
    const content = shell.props.children;
    const body = await (content.type as () => Promise<ReactElement>)();
    return renderToStaticMarkup(body);
  }
  const listed = (html: string) =>
    ["05", "06", "07", "08", "09", "10", "11"].filter((m) =>
      html.slice(html.indexOf("Month by month")).includes(monthLabel(`2026-${m}`)),
    );

  const shared = lines("2026-09-01", 8, 1_000);
  const founderShape = (): Made[] => [
    { name: "TOTAL CHECKING", linked: true, balance: 234_018, txns: shared },
    { name: "CHASE SAVINGS", linked: true, subtype: "savings", balance: 512_000 },
    {
      name: "Chase checking",
      balance: 234_018,
      txns: shared,
      on: ["2026-09-01", "2026-10-01", "2026-10-20"],
    },
    {
      name: "Chase checking old",
      balance: 99_000,
      txns: lines("2026-05-04", 8, 50_000),
      on: ["2026-05-04", "2026-06-01", "2026-06-22"],
    },
    {
      name: "Chase savings",
      subtype: "savings",
      balance: 512_000,
      txns: lines("2026-10-15", 3, 40_000),
      on: ["2026-08-15", "2026-10-29"],
    },
  ];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("lists no month only a left-out upload has a balance for", async () => {
    const { userId } = await person(founderShape());
    expect((await accountsNotCounted(scopedFor(userId, client))).size).toBe(3);
    expect(listed(await page())).toEqual(["11"]);
  });

  it("lists the months of an upload that is counted", async () => {
    await person([
      { name: "TOTAL CHECKING", linked: true, balance: 120_000, txns: shared },
      {
        name: "Chase checking",
        balance: 81_555,
        txns: lines("2026-09-02", 8, 70_000),
        on: ["2026-09-02", "2026-10-21"],
      },
    ]);
    expect(listed(await page())).toEqual(["09", "10", "11"]);
  });

  it("says under the figures what is left out", async () => {
    await person(founderShape());
    expect(await page()).toContain("left out of net worth");
  });

  it("never says the later upload was counted when it was left out too", async () => {
    const { userId, ids } = await person(founderShape());
    const db = scopedFor(userId, client);
    expect((await accountsNotCounted(db)).get(ids.get("Chase checking old")!)).toMatchObject({
      reason: "older_upload",
      sameAs: { id: ids.get("Chase checking") },
    });
    const said = (await leftOutNotes(db)).map(maybeSamePair);
    expect(said).toContain(
      "Chase checking old (uploaded) looks like an earlier upload of Chase checking, which Jane also left out, so neither is in net worth.",
    );
    expect(said.join(" ")).not.toContain("counted the later one");
  });

  it("raises no books problem about an account that is in no figure", async () => {
    const { userId } = await person(founderShape());
    await runBooksCheck(userId, { client, now: NOW });
    const left = await accountsNotCounted(scopedFor(userId, client));
    const books = await openBooks(userId, { client });
    expect(books.open.filter((o) => o.accountId && left.has(o.accountId))).toEqual([]);
    expect(books.markedAccountIds.filter((id) => left.has(id))).toEqual([]);
  });
});
