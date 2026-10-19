import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxSavings } from "@/lib/tax-savings";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions, parseRefs } from "./types";
import { sendToJane } from "./typing";

// Spec step 122 against a real, migrated Postgres: the demo bank's ways to pay less, each
// an estimate with its one button; Remind me sets a deadline, Not for me stops it; real
// accounts get none of it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("the tax savings finder against a real database", () => {
  let client: PrismaClient;
  let demoId: string;
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

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function post(userId: string, dedupeKey: string) {
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === dedupeKey);
    if (!candidate) return null;
    return client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    demoId = await person("tax-savings-demo");
    const { itemId } = await linkDemoBank(demoId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("finds the demo bank's 401(k) room, itemizing and student loan interest", async () => {
    const view = await loadTaxSavings(demoId, { client, now: LINKED });
    expect(view.advice).toBe(true);
    expect(view.savings.map((s) => s.key)).toEqual(["retirement", "itemize", "student_loan"]);
    expect(view.savings[0].title).toBe("Put about $1,975 more a paycheck into your 401(k)");
    expect(view.savings.every((s) => s.estimateCents > 0)).toBe(true);
  });

  it("Remind me puts the task on the person's deadlines", async () => {
    const message = (await post(demoId, "saving:2026:retirement"))!;
    expect(message.kind).toBe("decision");
    expect(message.body).toMatch(/By my estimate that's about \$[\d,]+ less tax for 2026\.$/);
    expect(parseRefs(message.refs).advice).toBe(true);
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.save_task",
      "tax.save_no",
      "snooze",
    ]);
    const after = (
      await takeChatAction(demoId, message.id, "tax.save_task", { client, now: later() })
    ).message;
    expect(after.refs.note).toBe(
      'Done: "Raise my 401(k) contribution by $1,975 a paycheck" is on your deadlines for Oct 25. I\'ll remind you.',
    );
    expect(
      await client.deadline.count({
        where: { userId: demoId, title: { startsWith: "Raise my 401(k)" } },
      }),
    ).toBe(1);
  });

  it("Not for me stops the suggestion for the year", async () => {
    const message = (await post(demoId, "saving:2026:itemize"))!;
    await takeChatAction(demoId, message.id, "tax.save_no", { client, now: later() });
    const view = await loadTaxSavings(demoId, { client, now: LINKED });
    expect(view.savings.map((s) => s.key)).toEqual(["retirement", "student_loan"]);
  });

  it("answers how can I pay less tax, and gives Claude the list as estimates", async () => {
    const { reply } = await sendToJane(demoId, "how can I pay less tax", { client, now: later() });
    expect(reply.body).toMatch(/^Put about \$1,975 more a paycheck into your 401\(k\)\./);
    expect(reply.body).toContain("Also: Your student loan interest lowers your tax");
    expect(parseRefs(reply.refs).advice).toBe(true);
    const tool = JSON.parse(
      (await runChatTool(demoId, "tax_savings", {}, { client, now: LINKED })).content,
    );
    expect(tool).toMatchObject({ year: 2026, isAnEstimate: true });
    expect(tool.savings[0].todo).toMatch(/^Reminder: Raise my 401\(k\)/);
  });

  it("real accounts get no suggestions, only where things are", async () => {
    const userId = await person("tax-savings-real");
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const view = await loadTaxSavings(userId, { client, now: LINKED });
    expect(view).toMatchObject({ advice: false, savings: [] });
    const { reply } = await sendToJane(userId, "how can I lower my taxes", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(
      /^Suggestions on paying less tax will come once Jane works with a tax professional\./,
    );
    expect(
      JSON.parse((await runChatTool(userId, "tax_savings", {}, { client, now: LINKED })).content),
    ).toMatchObject({
      available: false,
    });
  });
});
