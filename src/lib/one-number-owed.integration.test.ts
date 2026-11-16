import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { loadDebts } from "@/lib/debts";
import { loadHubAreas } from "@/lib/hub/load";
import { loadAheadHub } from "@/lib/hubs/ahead";
import { loadMoneyHub } from "@/lib/hubs/money";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { encrypt } from "@/lib/crypto";
import { formatCents } from "@/lib/money";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Gate B, "one number, one source" (docs/one-number.md): what a person owes is the loans page's
// book (loadDebts) on every surface that says it, for every sample person on the demo bank, whose
// second login is an account linked twice. Home's Loans tile and the Money page's "Loans and
// cards" and the money hub summed the linked accounts themselves and left out pay-later plans; Plans summed its own
// and counted the copy; the book's own total took a card in credit off what the others owe.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T17:00:00Z");

describe.runIf(url)("what's owed, one number", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const person = async (id: PersonId) => {
    const user = await client.user.create({
      data: { email: `one-number-owed-${id}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
    await syncItem(itemId, { client, now: NOW });
    return user.id;
  };

  // Every surface's owed, held to the book's.
  const expectOneOwed = async (userId: string) => {
    const o = { client, now: NOW };
    const book = await loadDebts(userId, o);
    const [areas, money, hub, ahead, chat] = await Promise.all([
      loadHubAreas(userId, { budgetsOver: 0, safeShort: false }, o),
      loadMoneyArea(userId, o),
      loadMoneyHub(userId, o),
      loadAheadHub(userId, o),
      runChatTool(userId, "debts", {}, o),
    ]);
    const lines = book.debts.reduce((sum, d) => sum + (d.balanceCents ?? 0), 0);
    const chatOwed = (JSON.parse(chat.content) as { totalOwed: string | null }).totalOwed;
    expect({
      "the book's lines": lines,
      "home loans tile": areas.loans?.owedCents ?? null,
      "money page": money!.have.debt.owedCents,
      "money hub": hub.debt.owedCents,
      chat: chatOwed === formatCents(book.totalOwedCents) ? book.totalOwedCents : chatOwed,
    }).toEqual({
      "the book's lines": book.totalOwedCents,
      "home loans tile": book.totalOwedCents,
      "money page": book.totalOwedCents,
      "money hub": book.totalOwedCents,
      chat: book.totalOwedCents,
    });
    // Plans says it "not the mortgage": the same book, less its mortgage.
    const mortgage = book.debts
      .filter((d) => d.kind === "mortgage")
      .reduce((sum, d) => sum + (d.balanceCents ?? 0), 0);
    expect(ahead.debt.owedCents).toBe(book.totalOwedCents - mortgage);
    return book;
  };

  it.each(PEOPLE.map((p) => p.id))("%s: owed is the loans page's everywhere", async (id) => {
    await expectOneOwed(await person(id));
  });

  it("counts a card linked twice once, and a card in credit as owing nothing", async () => {
    const user = await client.user.create({
      data: { email: "one-number-owed-relinked@example.com", timezone: "America/Los_Angeles" },
    });
    made.push(user.id);
    const item = async (n: string) =>
      (
        await client.plaidItem.create({
          data: {
            userId: user.id,
            plaidItemId: `item-owed-${n}`,
            accessTokenEncrypted: encrypt(`access-owed-${n}`),
            institutionName: "Chase",
          },
        })
      ).id;
    const [first, again] = [await item("first"), await item("again")];
    const card = (itemId: string, n: string, mask: string, cents: number) =>
      client.account.create({
        data: {
          userId: user.id,
          itemId,
          source: "plaid",
          plaidAccountId: `owed-${n}`,
          name: "Freedom",
          mask,
          type: "credit",
          subtype: "credit card",
          currentBalanceCents: cents,
        },
      });
    // $500 on the card, the same card again through a second login, and another card $40 in credit.
    await card(first, "card", "1111", 50_000);
    await card(again, "card-again", "1111", 50_000);
    await card(first, "credit", "2222", -4_000);
    const book = await expectOneOwed(user.id);
    expect(book.totalOwedCents).toBe(50_000);
  });
});
