import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { correctCategory } from "@/lib/categories";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { formatCents } from "@/lib/money";
import { parseIntent } from "@/lib/jane-agent/intents";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { closeSource } from "@/lib/jane-agent/sources/close";
import { reportSource } from "@/lib/jane-agent/sources/report";
import { closeReply } from "@/lib/jane-agent/replies-close";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadClose, runMonthClose } from "./month-close";

// Spec step 244 against a real, migrated Postgres: on the first of November Jane closes
// October. With nothing uncertain it closes with no taps; a closed month's figures stay put
// until the person corrects something in it; charges she wasn't sure of are asked about in one
// message, and one tap closes it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-11-01T09:00:00Z");
const NOW = new Date("2026-11-02T15:00:00Z");

describe.runIf(url)("the monthly close", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api, now: LINKED });
    // The demo bank's catch-all charges are the person's own choice here, so October is clear.
    await client.transaction.updateMany({
      where: {
        userId: user.id,
        pfcDetailed: {
          in: [
            "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
            "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
          ],
        },
      },
      data: { categorySource: "user" },
    });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    return { id: user.id, checking: checking.id };
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("closes a month with nothing uncertain with no taps, and keeps its figures", async () => {
    const { id: userId, checking } = await person("close-clear");
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("closed");
    const closed = (await loadClose(userId, { client }))!;
    expect(closed).toMatchObject({ month: "2026-10", status: "closed", correctedAt: null });
    expect(closed.figures.incomeCents).toBeGreaterThan(0);
    expect(closed.figures.spendingCents).toBeGreaterThan(0);
    expect(closed.figures.netWorthCents).not.toBeNull();
    expect(closed.figures.confirmed).toBe(0);

    // A charge that turns up late doesn't change a closed month, nor does running it again.
    await client.transaction.create({
      data: {
        userId,
        accountId: checking,
        source: "plaid",
        date: new Date("2026-10-30T00:00:00Z"),
        amountCents: 12_345,
        description: "LATE POSTING SHOP",
        pfcPrimary: "GENERAL_MERCHANDISE",
        pfcDetailed: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
      },
    });
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("none");
    expect((await loadClose(userId, { client }))!.figures).toEqual(closed.figures);

    // A correction in that month does: its figures are worked out again and marked corrected.
    const rent = await client.transaction.findFirstOrThrow({
      where: { userId, date: { gte: new Date("2026-10-01T00:00:00Z") }, amountCents: { gt: 0 } },
      orderBy: { amountCents: "desc" },
    });
    await correctCategory(userId, rent.id, "TRANSFER_OUT_ACCOUNT_TRANSFER", { client });
    const corrected = (await loadClose(userId, { client }))!;
    expect(corrected.correctedAt).not.toBeNull();
    expect(corrected.figures.spendingCents).toBe(
      closed.figures.spendingCents - rent.amountCents + 12_345,
    );
    // The snapshot taken at the close stays as it was.
    expect(corrected.figures.netWorthCents).toBe(closed.figures.netWorthCents);

    // Said in the chat once, in the month's report: the close has no message of its own when
    // nothing needs a tap (its figures are the report's).
    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    expect(gather(snapshot, NOW, { trigger: "open", sources: [closeSource] })).toEqual([]);
    const [report] = gather(snapshot, NOW, { trigger: "open", sources: [reportSource] });
    expect(report.body.split("\n")[0]).toBe("Your money report for October 2026 is ready.");
    expect(report.body).toMatch(/\nOctober 2026 is closed\. (Your books added up\.|\d+ things?)/);
    // Asked, the close still answers with its figures.
    expect(closeReply(snapshot.close!).body).toMatch(
      /^October 2026 is closed: \$[\d,]+\.\d\d came in/,
    );
  });

  it("asks once about charges it wasn't sure of, and one tap closes the month", async () => {
    const { id: userId, checking } = await person("close-ask");
    await client.transaction.create({
      data: {
        userId,
        accountId: checking,
        source: "plaid",
        date: new Date("2026-10-14T00:00:00Z"),
        amountCents: 28_500,
        description: "WEWORK",
        pfcPrimary: "GENERAL_SERVICES",
        pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        categorySource: "plaid",
      },
    });
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("waiting");
    const waiting = (await loadClose(userId, { client }))!;
    expect(waiting.status).toBe("waiting");
    expect(waiting.uncertain.map((t) => t.description)).toEqual(["WEWORK"]);

    expect(parseIntent("is last month closed?", "2026-11-02")).toEqual({ kind: "month_close" });
    const reply = (await answerByRules(userId, { kind: "month_close" }, { client, now: NOW }))!;
    expect(reply.body).toMatch(/^Closing October 2026: I wasn't sure what this charge was/);
    const tool = JSON.parse(
      (await runChatTool(userId, "month_close", {}, { client, now: NOW })).content,
    );
    expect(tool).toMatchObject({ month: "2026-10", status: "waiting" });

    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    await postMessages(userId, gather(snapshot, NOW, { trigger: "open", sources: [closeSource] }), {
      client,
      now: NOW,
    });
    const ask = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: "close:waiting:2026-10" },
    });
    expect(ask.kind).toBe("decision");
    const { message } = await takeChatAction(userId, ask.id, "close.confirm", {
      client,
      now: NOW,
    });
    expect(message.refs.note).toBe(
      "Thanks. October 2026 is closed; its figures stay as they are unless you correct something.",
    );
    const closed = (await loadClose(userId, { client }))!;
    expect(closed).toMatchObject({ status: "closed" });
    expect(closed.figures.confirmed).toBe(1);
    // Never asked about again.
    const wework = await client.transaction.findFirstOrThrow({
      where: { userId, description: "WEWORK" },
    });
    expect(wework.categorySource).toBe("user");
  });

  it("snapshots the net worth the chat and the net worth page give, home included", async () => {
    const { id: userId } = await person("close-worth");
    await client.ownedAsset.create({
      data: {
        userId,
        kind: "home",
        name: "Home",
        valueCents: 30_000_000,
        valuedOn: new Date("2026-10-01T00:00:00Z"),
      },
    });
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("closed");
    const closed = (await loadClose(userId, { client }))!;
    const tool = JSON.parse(
      (await runChatTool(userId, "net_worth", {}, { client, now: NOW })).content,
    );
    expect(formatCents(closed.figures.netWorthCents!)).toBe(tool.netWorth);
  });
});
