import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { creditBandFor, creditPartnerFor, loadCredit, pullCredit, refreshCredit } from "./credit";

// Spec step 116 against a real, migrated Postgres, on the demo bank: Jane's monthly soft
// pull of a stand-in score, labelled; what's helping and hurting with card use from the
// card balances; what she's doing about it; the score's band pricing the lender stand-ins;
// and nothing pulled for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(LINKED.getTime() + days * DAY);

describe.runIf(url)("the credit score against a real database", () => {
  let client: PrismaClient;
  let userId: string;
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
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await person("credit-demo");
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("pulls a labelled stand-in score once a month, by herself", async () => {
    await client.creditReport.deleteMany({ where: { userId } });
    expect(await refreshCredit(userId, opts())).toBe(true);
    expect(await refreshCredit(userId, opts(later(10)))).toBe(false);
    const credit = await loadCredit(userId, opts());
    expect(credit.latest).toMatchObject({ score: 705, demo: true, range: { low: 300, high: 850 } });
    expect(credit.latest!.utilisation?.share).toBeCloseTo(0.301, 3);
    expect(credit.latest!.factors.find((f) => f.key === "payment_history")).toMatchObject({
      impact: "hurting",
      detail: "1 late fee in the last year.",
    });
    expect(credit.latest!.doing[0]).toMatch(/^Paying \$10\.50 on your Demo Credit Card ····0003/);
    expect(credit.latest!.doing[0]).toMatch(/before it's due on [A-Z][a-z]{2} \d{1,2} brings/);
    expect(await creditBandFor(userId, opts())).toBe("good");
  });

  it("brings up card use that hurts the score, and a score that moved", async () => {
    const snapshot = await loadSnapshot(userId, opts());
    const messages = gather(snapshot!, LINKED, { trigger: "sync" }).filter(
      (m) => m.source === "credit",
    );
    expect(messages.map((m) => m.dedupeKey)).toEqual(["credit:use:2026-10-18"]);
    expect(messages[0].body).toContain(
      "Paying $10.50 before the statement closes brings it under 30%.",
    );
    expect(messages[0].body).toContain(
      "This is a stand-in score for the demo bank, not your real credit score.",
    );

    // A month later the card is paid down: the next pull is higher and Jane says so.
    await client.account.updateMany({
      where: { userId, type: "credit" },
      data: { currentBalanceCents: 40_000 },
    });
    await pullCredit(userId, opts(later(31)));
    const next = await loadSnapshot(userId, opts(later(31)));
    const moved = gather(next!, later(31), { trigger: "sync" }).find((m) =>
      m.dedupeKey.startsWith("credit:moved"),
    );
    expect(moved?.body).toMatch(/^Your credit score went up \d+ points to \d+\./);
  });

  it("answers by rules and for Claude", async () => {
    const { reply } = await sendToJane(userId, "what's my credit score?", opts(later(31)));
    expect(reply.body).toMatch(
      /^Your score is \d+ \(300–850\), up \d+ since last month\. This is a stand-in score/,
    );
    expect(reply.body).toContain("What I'm doing about it:");
    const tool = await runChatTool(userId, "credit_score", {}, opts(later(31)));
    expect(JSON.parse(tool.content)).toMatchObject({ standIn: true, lastMonth: 705 });
  });

  it("never pulls anything for a real account", async () => {
    const realId = await person("credit-real");
    await client.account.create({
      data: {
        userId: realId,
        source: "csv",
        name: "Card",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 1_000,
      },
    });
    expect(await creditPartnerFor(realId, opts())).toBeNull();
    expect(await pullCredit(realId, opts())).toBeNull();
    expect(await refreshCredit(realId, opts())).toBe(false);
    expect(await client.creditReport.count({ where: { userId: realId } })).toBe(0);
    const { reply } = await sendToJane(realId, "credit score", opts());
    expect(reply.body).toMatch(/^A credit score comes from a credit partner/);
  });
});
