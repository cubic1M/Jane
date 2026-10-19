import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { BT_MIN_SAVING_CENTS } from "@/config/debt";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { TransferError, loadTransfers, startTransfer } from "./balance-transfers";
import { loadDebts } from "./debts";

// Spec step 113 against a real, migrated Postgres, on the demo bank: 0% transfer offers for
// the card from Jane's monthly check, compared with the fee counted; "I've moved it" puts
// the promo's end on the deadlines; Jane reminds 60, 30 and 7 days before, each once; the
// demo bank shows the card cleared, the 0% card joins the debts, and "It's paid off" ends it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(LINKED.getTime() + days * DAY);

describe.runIf(url)("balance transfers against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let itemId: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const opts = (now = LINKED) => ({ client, now });
  const fromSource = async (now: Date) => {
    const snapshot = await loadSnapshot(userId, opts(now));
    return gather(snapshot!, now, { trigger: "sync" }).filter((m) => m.source === "transfers");
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `bt-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    ({ itemId } = await linkDemoBank(userId, { client, now: LINKED }));
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("compares 0% offers for the card from Jane's monthly check, fee counted", async () => {
    const data = await loadTransfers(userId, opts());
    expect(data.available).toBe(true);
    const [card] = data.comparisons;
    expect(card.debtName).toBe("Demo Credit Card ····0003");
    for (const s of card.offers) {
      expect(s.savingCents).toBe(s.keepInterestCents! - s.offer.feeCents);
    }
    expect(card.pick!.savingCents!).toBeGreaterThanOrEqual(BT_MIN_SAVING_CENTS);
    const [offer] = await fromSource(LINKED);
    expect(offer).toMatchObject({ kind: "decision", refs: { advice: true } });
    expect(offer.actions[0].label).toBe(`I've moved it to ${card.pick!.offer.cardName}`);
  });

  it("answers in the chat, and 'I've moved it' puts the 0% end on the deadlines", async () => {
    const { reply } = await sendToJane(userId, "should I do a balance transfer?", opts());
    expect(reply.body).toMatch(
      /^For your Demo Credit Card ····0003 \(\$2,410\.50 at 22\.99%\), I'd move it to /,
    );
    expect(reply.body).toContain("transfer fee is counted");
    const tapped = await takeChatAction(userId, reply.id, "transfer.start", opts());
    expect(tapped.message.refs.note).toMatch(
      /^Got it\. To clear it before the 0% ends on \w{3} \d+, \d{4}, pay \$[\d,.]+ a month\./,
    );
    const [t] = (await loadTransfers(userId, opts())).transfers;
    expect(t).toMatchObject({ status: "active", amountCents: 241_050 });
    const deadline = await client.deadline.findFirstOrThrow({ where: { userId } });
    expect(deadline.dueOn.toISOString().slice(0, 10)).toBe(t.promoEndsOn);
    expect(deadline.title).toBe(`0% ends on ${t.cardName}: pay off the balance you moved`);
    // One transfer per card at a time, and the offer stops coming up.
    await expect(
      startTransfer(userId, { debtKey: t.fromDebtKey, offerId: "x" }, opts()),
    ).rejects.toThrow(TransferError);
    expect((await fromSource(LINKED)).filter((m) => m.kind === "decision")).toEqual([]);
  });

  it("shows the card cleared and the 0% card among the debts", async () => {
    await syncItem(itemId, { client, api: plaid, now: at(3) });
    const book = await loadDebts(userId, opts(at(3)));
    expect(book.debts.find((d) => d.name === "Demo Credit Card ····0003")?.balanceCents).toBe(0);
    const [t] = (await loadTransfers(userId, opts(at(3)))).transfers;
    const zero = book.debts.find((d) => d.key === `transfer:${t.id}`)!;
    expect(zero).toMatchObject({
      name: t.cardName,
      kind: "card",
      aprBps: 0,
      balanceCents: t.amountCents + t.feeCents,
      aprFrom: "accepted",
    });
  });

  it("reminds 60, 30 and 7 days before the 0% ends, each once", async () => {
    const [t] = (await loadTransfers(userId, opts())).transfers;
    const end = Date.parse(`${t.promoEndsOn}T15:00:00Z`);
    const before = (days: number) => new Date(end - days * DAY);
    expect(await fromSource(before(90))).toEqual([]);
    const keys = [];
    for (const days of [60, 30, 7]) {
      const [m] = await fromSource(before(days));
      expect(m).toMatchObject({ kind: "heads_up", dedupeKey: `transfers:remind:${t.id}:${days}` });
      expect(m.body).toMatch(new RegExp(`in ${days} days\\. Anything left then is charged`));
      keys.push(m.dedupeKey);
    }
    expect(new Set(keys).size).toBe(3);
  });

  it("gives Claude the offers and the transfer, and 'It's paid off' ends it", async () => {
    const tool = await runChatTool(userId, "balance_transfers", {}, opts());
    const output = JSON.parse(tool.content);
    expect(output.transfersMade[0]).toMatchObject({ status: "active", moved: "$2,410.50" });
    expect(tool.cents).toContain(241_050);

    const [t] = (await loadTransfers(userId, opts())).transfers;
    const end = Date.parse(`${t.promoEndsOn}T15:00:00Z`);
    const now = new Date(end - 7 * DAY);
    const snapshot = await loadSnapshot(userId, opts(now));
    const [reminder] = gather(snapshot!, now, { trigger: "sync" }).filter(
      (m) => m.source === "transfers",
    );
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: reminder.kind,
        body: reminder.body,
        refs: reminder.refs,
        actions: reminder.actions,
        dedupeKey: reminder.dedupeKey,
      },
    });
    const done = await takeChatAction(userId, message.id, "transfer.done", opts(now));
    expect(done.message.refs.note).toMatch(/is paid off before the 0% ended/);
    expect((await client.deadline.findFirstOrThrow({ where: { userId } })).doneAt).not.toBeNull();
    expect(await fromSource(new Date(end - 2 * DAY))).toEqual([]);
  });
});
