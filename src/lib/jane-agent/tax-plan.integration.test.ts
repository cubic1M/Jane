import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { TaxPlanError, addPlanMove, loadTaxPlan } from "@/lib/tax-plan";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 167 against a real, migrated Postgres: the demo bank's 2026 tax plan in
// October, each move brought up when its time comes with its deadline, put on the
// deadlines with one tap (or by Jane at Handle the safe stuff), and nothing offered past
// its deadline.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const JANUARY = new Date("2027-01-05T16:00:00Z");
const RETIREMENT = "2026:workplace_retirement";

describe.runIf(url)("the year-round tax plan against a real database", { timeout: 60_000 }, () => {
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

  async function demoPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  const gather = async (userId: string, now = LINKED) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now }))!, {
      now,
      local: { date: now.toISOString().slice(0, 10), hour: 8 },
      trigger: "open",
    });
  async function post(userId: string, dedupeKey: string) {
    const candidate = (await gather(userId)).find((c) => c.dedupeKey === dedupeKey);
    expect(candidate, dedupeKey).toBeDefined();
    return client.janeMessage.create({
      data: {
        userId,
        kind: candidate!.kind,
        body: candidate!.body,
        refs: candidate!.refs,
        actions: candidate!.actions,
        dedupeKey: `taxes:${dedupeKey}`,
      },
    });
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("lays out the year's moves by deadline, each from config", async () => {
    const userId = await demoPerson("tax-plan");
    const plan = await loadTaxPlan(userId, { client, now: LINKED });
    expect(plan.moves.map((m) => [m.id, m.deadline, m.open])).toEqual([
      [RETIREMENT, "2026-12-31", true],
      ["2026:harvest", "2026-12-31", true],
      ["2026:giving", "2026-12-31", false],
      ["2026:file", "2027-04-15", false],
    ]);
  });

  it("brings an open move up once, and Add to my deadlines puts its reminder there", async () => {
    const userId = await demoPerson("tax-plan-ask");
    const message = await post(userId, `plan:${RETIREMENT}`);
    expect(message.body).toMatch(
      /^Tax move: Put more into your 401\(k\) before your last paycheck, by Dec 31\. Put about \$[\d,]+ more a paycheck into your 401\(k\): .+ Want it on your deadlines\?$/,
    );
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.plan_add",
      "tax.plan_no",
      "open",
    ]);
    const after = (
      await takeChatAction(userId, message.id, "tax.plan_add", { client, now: LINKED })
    ).message;
    expect(after.refs.note).toBe(
      'Done: "Put more into your 401(k) before your last paycheck (2026 taxes)" is on your deadlines.',
    );
    const deadline = await client.deadline.findFirstOrThrow({
      where: { userId, title: "Put more into your 401(k) before your last paycheck (2026 taxes)" },
    });
    expect(deadline.dueOn.toISOString().slice(0, 10)).toBe("2026-12-31");
    // Not brought up again, and not added twice.
    expect((await gather(userId)).some((c) => c.dedupeKey === `plan:${RETIREMENT}`)).toBe(false);
    await expect(
      addPlanMove(userId, RETIREMENT, { client, now: LINKED, via: "page" }),
    ).rejects.toThrow("already done");

    const harvest = await post(userId, "plan:2026:harvest");
    await takeChatAction(userId, harvest.id, "tax.plan_no", { client, now: LINKED });
    expect(
      (await loadTaxPlan(userId, { client, now: LINKED })).moves.find((m) => m.key === "harvest")!
        .handled,
    ).toBe("no");
  });

  it("puts open moves on the deadlines by itself at Handle the safe stuff, and says so", async () => {
    const userId = await demoPerson("tax-plan-auto");
    await setAutopilot(userId, "safe", { client, now: LINKED });
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).planAdded).toBe(2);
    expect(
      await client.deadline.count({ where: { userId, title: { endsWith: "(2026 taxes)" } } }),
    ).toBe(2);
    const done = (await gather(userId)).filter((c) => c.dedupeKey.startsWith("plan:"));
    expect(done.map((c) => [c.dedupeKey, c.kind])).toEqual([
      [`plan:${RETIREMENT}`, "done"],
      ["plan:2026:harvest", "done"],
    ]);
    expect(done[1].body).toMatch(/I've put it on your deadlines\.$/);
    expect(done[1].refs.advice).toBe(true);
    // Once.
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).planAdded).toBe(0);
  });

  it("offers nothing past its deadline", async () => {
    const userId = await demoPerson("tax-plan-late");
    const plan = await loadTaxPlan(userId, { client, now: JANUARY });
    expect(plan.moves.every((m) => m.deadline >= "2027-01-05")).toBe(true);
    expect(plan.moves.some((m) => m.key === "workplace_retirement")).toBe(false);
    await expect(
      addPlanMove(userId, RETIREMENT, { client, now: JANUARY, via: "page" }),
    ).rejects.toBeInstanceOf(TaxPlanError);
  });

  it("answers my tax plan, and gives Claude it", async () => {
    const userId = await demoPerson("tax-plan-chat");
    const { reply } = await sendToJane(userId, "what's my tax plan", { client, now: LINKED });
    expect(reply.body).toBe(
      "Your 2026 tax plan, by deadline:\n- By Dec 31: Put more into your 401(k) before your last paycheck (open now)\n- By Dec 31: Sell at a loss before the year ends (open now)\n- By Dec 31: Make this year's gifts before December 31 (I'll bring it up Nov 1)\n- By Apr 15: File your return (I'll bring it up Jan 20)",
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_plan", {}, { client, now: LINKED })).content,
    );
    expect(tool.moves.map((m: { deadline: string }) => m.deadline)).toEqual([
      "2026-12-31",
      "2026-12-31",
      "2026-12-31",
      "2027-04-15",
    ]);
    expect(tool.moves[1]).toMatchObject({ demoAdvice: true, amount: expect.stringMatching(/^\$/) });
  });
});
