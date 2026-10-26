import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { ChatActionError, takeChatAction } from "../actions";
import { createCheckPerson, deleteCheckPerson } from "../checks/person";
import { sendToJane } from "../typing";
import type { ChatMessage } from "../types";

// Spec step 95 end to end, against a real, migrated Postgres and the demo bank: each flow
// asks one question at a time, can be left and picked up again, goes Back, ends in the
// feature's own code, and changes nothing when cancelled.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles.
const LINKED = new Date("2026-10-18T15:00:00Z");
let minute = 0;
const next = () => new Date(LINKED.getTime() + ++minute * 60_000);

describe.runIf(url)("guided flows against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: LINKED });
    otherId = await createCheckPerson({ client, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await deleteCheckPerson(otherId, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const say = async (text: string) =>
    (await sendToJane(userId, text, { client, now: next() })).reply;
  const tap = async (message: ChatMessage, label: string) => {
    const action = message.actions.find((a) => a.label === label);
    if (!action) throw new Error(`No "${label}" on: ${message.actions.map((a) => a.label)}`);
    return (await takeChatAction(userId, message.id, action.id, { client, now: next() })).message;
  };

  it("sets up a budget, going Back once, through Budgets", async () => {
    const first = await say("set up a budget");
    expect(first.body).toMatch(/^Setting up a budget, 1 of 2: Which category\?/);
    const category = first.actions[0].label;
    const second = await tap(first, category);
    expect(second.status).toBe("open");
    expect(second.body).toMatch(
      new RegExp(`^Setting up a budget, 2 of 2: How much a month for ${category}\\?`),
    );
    // Another person can't answer it.
    await expect(
      takeChatAction(otherId, second.id, "flow.pick.1", { client, now: next() }),
    ).rejects.toBeInstanceOf(ChatActionError);
    const back = await tap(second, "Back");
    expect(back.body).toMatch(/1 of 2/);
    const again = await tap(back, category);
    const done = await tap(again, again.actions[0].label);
    expect(done.status).toBe("answered");
    expect(done.refs.note).toMatch(
      new RegExp(`^Done\\. Your ${category} budget is \\$[\\d,]+\\.00 a month`),
    );
    expect(await client.budget.count({ where: { userId, category } })).toBe(1);
  });

  it("starts a goal with typed answers, and can be left and picked up again", async () => {
    const first = await say("start a goal");
    expect(first.body).toMatch(
      /^Starting a goal, 1 of 3: What are you saving for\? Or type your own\.$/,
    );
    const amount = await say("a new laptop");
    expect(amount.body).toMatch(/^Starting a goal, 2 of 3: How much/);
    // Left for something else, then picked up where it was.
    await say("safe to spend");
    const resumed = await say("continue");
    expect(resumed.body).toMatch(/^Let's pick up where we left off\. Starting a goal, 2 of 3/);
    const when = await say("$1,500");
    expect(when.body).toMatch(/^Starting a goal, 3 of 3: By when\?/);
    const done = await tap(when, "In a year");
    expect(done.refs.note).toMatch(/^Added "A new laptop": \$1,500\.00 by October 2027\./);
    expect(
      await client.savingsGoal.findMany({
        where: { userId },
        select: { name: true, targetCents: true },
      }),
    ).toEqual([{ name: "A new laptop", targetCents: 150_000 }]);
  });

  it("changes nothing when cancelled", async () => {
    const before = await client.budget.count({ where: { userId } });
    const first = await say("set up a budget");
    const second = await tap(first, first.actions[0].label);
    const cancelled = await tap(second, "Cancel");
    expect(cancelled).toMatchObject({ status: "dismissed", answeredWith: "Cancel" });
    expect(cancelled.refs.note).toBe("OK, I've stopped. Nothing was changed.");
    expect(await client.budget.count({ where: { userId } })).toBe(before);
    expect((await say("continue")).body).toBe("There's nothing to pick up right now.");
  });

  it("switches a provider: the option picked, as a finding's own Yes", async () => {
    const first = await say("switch my phone plan");
    expect(first.body).toMatch(/^Switching a provider, 1 of 3: Which one/);
    const options = await tap(first, first.actions[0].label);
    expect(options.body).toMatch(/My pick is first\.$/);
    // Jane's pick, the first.
    const confirm = await tap(options, options.actions[0].label);
    const done = await tap(confirm, "Yes, switch");
    expect(done.refs.note).toMatch(/sign-up step/);
    const decision = await client.decision.findFirstOrThrow({
      where: { userId, source: "chat", choice: "yes" },
      orderBy: { createdAt: "desc" },
    });
    expect((decision.options as { switchTo?: string }).switchTo).toBeTruthy();
  }, 120_000); // Several chat rounds against a real database: slow on CI runners.

  it("disputes a charge: asking for the money back, as the finding's own Yes", async () => {
    const first = await say("dispute a charge");
    expect(first.body).toMatch(/^Disputing a charge, 1 of 2: Which charge\?/);
    const confirm = await tap(first, first.actions[0].label);
    expect(confirm.body).toMatch(/Should I ask for it back\?$/);
    const done = await tap(confirm, "Yes, ask for it back");
    expect(done.refs.note).toMatch(/^Got it\. I'll ask for the money back today/);
  });
});
