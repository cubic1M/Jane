import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { tightMoneySource } from "@/lib/jane-agent/sources/tight-money";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { TightMoneyError, loadTightMoney, refreshTightMoney, sendTightItem } from "./tight-money";

// Spec step 177 against a real, migrated Postgres, on the demo bank with checking pushed low
// so the forecast dips under its cushion: the bills in order with essentials first, the
// requests Jane prepares (each only sent on a tap, once), the lender stand-in's answers,
// and nothing sent for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("a tight month against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  let tick = 0;
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
  const opts = (now = LINKED) => ({ client, now });
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  // The demo bank with checking down to $50, so the month's bills take it under.
  async function tightPerson(prefix: string) {
    const id = await person(prefix);
    const { itemId } = await linkDemoBank(id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    await client.account.updateMany({
      where: { userId: id, subtype: "checking" },
      data: { currentBalanceCents: 5_000, availableBalanceCents: 5_000 },
    });
    return id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("finds the shortfall and puts essentials first", async () => {
    const id = await tightPerson("tight-plan");
    const data = await loadTightMoney(id, opts());
    expect(data.available).toBe(true);
    expect(data.shortfall).not.toBeNull();
    expect(data.shortfall!.balanceCents).toBeLessThan(10_000);
    const essentials = data.billsFirst.filter((b) => b.essential);
    expect(essentials.length).toBeGreaterThan(0);
    // Every essential comes before every other bill.
    const firstOther = data.billsFirst.findIndex((b) => !b.essential);
    if (firstOther >= 0) {
      expect(data.billsFirst.slice(firstOther).every((b) => !b.essential)).toBe(true);
    }
    // Nothing prepared asks housing to wait.
    expect(data.items.every((i) => !/mortgage/i.test(i.debtName))).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
  });

  it("shows nothing tight when the forecast is fine", async () => {
    const id = await person("tight-fine");
    const { itemId } = await linkDemoBank(id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    await client.account.updateMany({
      where: { userId: id, subtype: "checking" },
      data: { currentBalanceCents: 90_000_000 },
    });
    const data = await loadTightMoney(id, opts());
    expect(data.shortfall).toBeNull();
    expect(data.items).toEqual([]);
    const { reply } = await sendToJane(id, "money is tight this month", { client, now: later() });
    expect(reply.body).toMatch(/^Your checking forecast stays above its cushion/);
  });

  it("brings the plan up with the first request ready to send, and sends nothing itself", async () => {
    const id = await tightPerson("tight-chat");
    const snapshot = (await loadSnapshot(id, opts()))!;
    const [plan] = tightMoneySource
      .gather(snapshot, context)
      .filter((c) => c.dedupeKey.startsWith("tight:"));
    expect(plan.kind).toBe("decision");
    expect(plan.body).toMatch(
      /^Your checking is forecast to be .* on \w{3} \d+, \$[\d,.]+ under the cushion/,
    );
    expect(plan.body).toContain("Pay these first, essentials before anything else:");
    expect(plan.body).toContain("nothing is sent until you tap");
    expect(plan.actions[0]).toMatchObject({ id: "tight.send" });
    expect(await client.tightRequest.count({ where: { userId: id } })).toBe(0);
  });

  it("sends one request per tap, once, audited, and offers the next", async () => {
    const id = await tightPerson("tight-send");
    const { reply } = await sendToJane(id, "I'm short on money this month", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^Your checking is forecast/);
    expect(parseActions(reply.actions)[0].id).toBe("tight.send");
    const tapped = await takeChatAction(id, reply.id, "tight.send", { client, now: later() });
    expect(tapped.message.refs.note).toMatch(/^Sent to .*\. I'll tell you what they answer\./);
    const rows = await client.tightRequest.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", partner: "demo" });
    expect(rows[0].body.length).toBeGreaterThan(50);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id },
      "tight_request_sent",
      expect.objectContaining({ type: "tight_request" }),
      expect.objectContaining({ kind: rows[0].kind }),
    );
    const data = await loadTightMoney(id, opts());
    const sent = data.items.find((i) => i.sent);
    expect(sent!.id).toBe(rows[0].key.slice(0, rows[0].key.lastIndexOf(":")));
    await expect(sendTightItem(id, sent!.id, opts())).rejects.toThrow(TightMoneyError);
    await expect(sendTightItem(id, "hardship:nothing", opts())).rejects.toThrow(TightMoneyError);
  });

  it("answers each request after two days, and says what the lender answered", async () => {
    const id = await tightPerson("tight-answer");
    const first = (await loadTightMoney(id, opts())).items[0];
    await sendTightItem(id, first.id, opts());
    expect(await refreshTightMoney(id, opts())).toBe(0);
    const after = new Date(LINKED.getTime() + 3 * DAY);
    expect(await refreshTightMoney(id, opts(after))).toBe(1);
    const row = await client.tightRequest.findFirstOrThrow({ where: { userId: id } });
    expect(["granted", "declined"]).toContain(row.status);
    expect(row.outcome).toMatch(/^(Approved|Declined):/);
    expect(await refreshTightMoney(id, opts(after))).toBe(0);
    const snapshot = (await loadSnapshot(id, opts(after)))!;
    const answer = tightMoneySource
      .gather(snapshot, { ...context, now: after })
      .find((c) => c.dedupeKey === `tight_answer:${row.id}`);
    expect(answer!.kind).toBe(row.status === "granted" ? "done" : "heads_up");
    const tool = JSON.parse((await runChatTool(id, "tight_money", {}, opts(after))).content);
    expect(tool.alwaysNeedsATap).toBe("sending any request");
    expect(tool.requests.some((r: { sent: unknown }) => r.sent)).toBe(true);
  });

  it("never sends anything for a real account", async () => {
    const realId = await person("tight-real");
    expect((await loadTightMoney(realId, opts())).available).toBe(false);
    await expect(sendTightItem(realId, "hardship:account:x", opts())).rejects.toThrow(
      TightMoneyError,
    );
    expect(await client.tightRequest.count({ where: { userId: realId } })).toBe(0);
  });
});
