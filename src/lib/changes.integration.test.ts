import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runDetection } from "@/detection/engine";
import { setAutopilot } from "@/lib/autopilot";
import { AS_THEY_COME } from "@/lib/jane-agent/preferences";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { postMessages } from "@/lib/jane-agent/messages";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { changesSource } from "@/lib/jane-agent/sources/changes";
import { didSource } from "@/lib/jane-agent/sources/did";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadChanges, markChangeExpected } from "./changes";

// Spec step 97 against a real, migrated Postgres, with the demo bank: Jane notices the
// Netflix price rise, the new overdraft fee and the big Apple purchase; at "Handle the safe
// stuff" she has already asked for the old price by herself; "That's expected" sticks; and
// the heads-ups' buttons work through the features' own code.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles, mid-month. Jane talks the next morning: the first day's messages
// (findings, the autopilot question) fill that day's limit.
const LINKED = new Date("2026-10-18T15:00:00Z");
const NEXT_DAY = new Date("2026-10-19T15:00:00Z");

// Each test links and syncs a year of demo data, so they get more time than usual.
describe.runIf(url)("Jane notices changes, with the demo bank", { timeout: 30_000 }, () => {
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
    // Each message on its own, within the daily limits (spec step 184's "as they come"):
    // these tests are about when a change comes up by itself.
    await client.janePreference.create({
      data: { userId: user.id, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  const messages = (userId: string) =>
    client.janeMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  // Every change heads-up at once, past the daily limits, to try each one's buttons.
  async function postAllChanges(userId: string) {
    const snapshot = await loadSnapshot(userId, { client, now: NEXT_DAY });
    const planned = gather(snapshot!, NEXT_DAY, { trigger: "open", sources: [changesSource] });
    await postMessages(userId, planned, { client, now: NEXT_DAY });
  }
  const changeMessages = async (userId: string) =>
    (await messages(userId)).filter((m) => m.dedupeKey.startsWith("changes:"));

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("finds the demo bank's price rise, new fee and big month for shopping", async () => {
    const userId = await demoPerson("changes-find");
    const changes = await loadChanges(userId, { client, now: LINKED });
    const kinds = changes.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["bill_changed", "new_fee", "category_pace"]));

    const netflix = changes.find((c) => c.kind === "bill_changed" && c.merchant === "Netflix");
    expect(netflix).toMatchObject({
      title: "Netflix went up from $15.49 to $17.99.",
      up: true,
      finding: { type: "price_increase", handledBy: null },
    });
    const fee = changes.find((c) => c.kind === "new_fee");
    expect(fee?.title).toMatch(/^An overdraft fee of \$34\.00 on /);
    expect(fee?.finding).toMatchObject({ type: "bank_fees" });
    // The $1,349 Apple Store purchase two days ago.
    const shopping = changes.find((c) => c.kind === "category_pace" && c.category === "Shopping");
    expect(shopping?.title).toMatch(/^You've spent \$[\d,]+\.\d\d on Shopping so far this month\./);
    expect(shopping?.amountCents).toBeGreaterThan(134_900);
    // Peacock started two months ago. Its subscription card is the same thing, so the two
    // are said once (docs/feature-audit.md, cluster 10).
    const peacock = changes.find((c) => c.kind === "new_subscription");
    expect(peacock?.merchant).toBe("Peacock");
    expect(peacock?.finding).toMatchObject({ type: "subscription_review", handledBy: null });
    // The demo payroll is steady: nothing late, smaller or new.
    expect(kinds.some((k) => k.startsWith("paycheck") || k === "new_employer")).toBe(false);
  });

  it("says Jane already asked for the old price at 'Handle the safe stuff'", async () => {
    const userId = await demoPerson("changes-auto");
    await setAutopilot(userId, "safe", { client, now: LINKED });
    const changes = await loadChanges(userId, { client, now: LINKED });
    const netflix = changes.find((c) => c.kind === "bill_changed" && c.merchant === "Netflix");
    expect(netflix?.finding).toMatchObject({ type: "price_increase", handledBy: "rule" });

    // So it isn't asked about: the rule's own message says so (with Undo), and so does
    // "what changed?".
    await postAllChanges(userId);
    expect((await changeMessages(userId)).some((m) => m.body.startsWith("Netflix"))).toBe(false);
    const snapshot = await loadSnapshot(userId, { client, now: NEXT_DAY });
    const did = gather(snapshot!, NEXT_DAY, { trigger: "open", sources: [didSource] });
    expect(did.some((c) => c.body.includes("Netflix") && c.body.includes("under your rule"))).toBe(
      true,
    );
    const answer = await answerByRules(userId, { kind: "changes" }, { client, now: LINKED });
    expect(answer?.body).toContain(
      "- Netflix went up from $15.49 to $17.99. I've already asked them for your old price. (autopilot)",
    );
  });

  it("asks first at 'Ask me first', and Look into it says yes from the chat", async () => {
    const userId = await demoPerson("changes-ask");
    await setAutopilot(userId, "ask", { client, now: LINKED });
    await postAllChanges(userId);
    const posted = await changeMessages(userId);
    const netflix = posted.find((m) => m.body.startsWith("Netflix went up"))!;
    expect(netflix.body).toBe(
      "Netflix went up from $15.49 to $17.99. Want me to ask them for your old price?",
    );
    expect(parseActions(netflix.actions).map((a) => a.id)).toEqual([
      "change.look",
      "change.expected",
      "open",
    ]);
    const findingId = parseRefs(netflix.refs).findingId!;
    // Nothing was decided before the tap.
    expect(await client.decision.count({ where: { userId, findingId } })).toBe(0);
    const { message } = await takeChatAction(userId, netflix.id, "change.look", {
      client,
      now: LINKED,
    });
    expect(message).toMatchObject({ status: "answered", answeredWith: "Look into it" });
    expect(await client.decision.findFirst({ where: { userId, findingId } })).toMatchObject({
      choice: "yes",
      source: "chat",
    });
  });

  it("brings a change up by herself in her usual morning run, within the daily limits", async () => {
    const userId = await demoPerson("changes-run");
    await setAutopilot(userId, "ask", { client, now: LINKED });
    await runJaneAgent(userId, { client, now: NEXT_DAY, trigger: "cron" });
    const posted = await changeMessages(userId);
    // Within the day's limit: bill reminders only take a slot when money could run short, so
    // both changes get one.
    expect(posted.map((m) => m.body)).toEqual([
      "Netflix went up from $15.49 to $17.99. Want me to ask them for your old price?",
      "An overdraft fee of $34.00 on Demo Checking, on Oct 13. Want me to ask for it back?",
    ]);
    // Its finding isn't asked about twice.
    const findingId = parseRefs(posted[0].refs).findingId;
    const asked = (await messages(userId)).filter((m) => m.dedupeKey === `findings:${findingId}`);
    expect(asked).toEqual([]);
  });

  it("keeps a change away once it's expected, from the chat or by hand", async () => {
    const userId = await demoPerson("changes-expected");
    const before = await loadChanges(userId, { client, now: LINKED });
    const fee = before.find((c) => c.kind === "new_fee")!;
    await markChangeExpected(userId, fee.key, fee.kind, { client });
    // Twice is fine.
    await markChangeExpected(userId, fee.key, fee.kind, { client });
    const after = await loadChanges(userId, { client, now: LINKED });
    expect(after.map((c) => c.key)).not.toContain(fee.key);
    expect(after).toHaveLength(before.length - 1);

    // From the chat: "That's expected" on a heads-up.
    await postAllChanges(userId);
    const message = (await changeMessages(userId))[0];
    const key = parseRefs(message.refs).change!.key;
    await takeChatAction(userId, message.id, "change.expected", { client, now: LINKED });
    expect(await client.changeAck.count({ where: { userId, key } })).toBe(1);
    // It was the price rise Jane offered to fight: expected is a No to that.
    expect(key).toBe("bill:merchant:netflix:1799");
    const findingId = parseRefs(message.refs).findingId!;
    expect(await client.decision.findFirst({ where: { userId, findingId } })).toMatchObject({
      choice: "no",
      source: "chat",
    });
    // A day later it's still gone, from the brain and from "what changed?".
    const tomorrow = new Date(LINKED.getTime() + 24 * 60 * 60 * 1000);
    expect((await loadChanges(userId, { client, now: tomorrow })).map((c) => c.key)).not.toContain(
      key,
    );
    const answer = await answerByRules(userId, { kind: "changes" }, { client, now: LINKED });
    expect(answer?.body).not.toContain(message.body.split(".")[0]);
  });

  it("sets a budget from a category's heads-up", async () => {
    const userId = await demoPerson("changes-budget");
    await postAllChanges(userId);
    const message = (await changeMessages(userId)).find((m) => m.body.includes("Shopping"))!;
    expect(message.body).toMatch(/Want a budget for it\?$/);
    const { budgetCents } = parseRefs(message.refs).change!;
    const { message: answered } = await takeChatAction(userId, message.id, "change.budget", {
      client,
      now: LINKED,
    });
    expect(answered.refs.note).toMatch(/^Done\. Your Shopping budget is \$[\d,]+\.00 a month/);
    expect(
      await client.budget.findFirst({ where: { userId, category: "Shopping" } }),
    ).toMatchObject({ amountCents: budgetCents });
  });

  it("answers 'what changed?' and gives Claude the same, with its figures recorded", async () => {
    const userId = await demoPerson("changes-ask-rules");
    const answer = await answerByRules(userId, { kind: "changes" }, { client, now: LINKED });
    expect(answer?.body).toMatch(/^\d+ things changed lately\.\n- /);
    expect(answer?.body).toContain("- Netflix went up from $15.49 to $17.99.");

    const tool = await runChatTool(userId, "recent_changes", {}, { client, now: LINKED });
    const out = JSON.parse(tool.content) as { changes: { said: string; amount: string }[] };
    expect(out.changes.some((c) => c.said.startsWith("Netflix went up"))).toBe(true);
    expect(tool.cents).toEqual(expect.arrayContaining([1799, 1549]));
  });

  it("only ever sees the person's own data", async () => {
    const demo = await demoPerson("changes-own");
    const other = await client.user.create({
      data: { email: `changes-other-${crypto.randomUUID()}@example.com` },
    });
    created.push(other.id);
    expect(await loadChanges(other.id, { client, now: LINKED })).toEqual([]);
    const [first] = await loadChanges(demo, { client, now: LINKED });
    // Another person's "That's expected" changes nothing for them.
    await markChangeExpected(other.id, first.key, first.kind, { client });
    expect((await loadChanges(demo, { client, now: LINKED })).map((c) => c.key)).toContain(
      first.key,
    );
    await runDetection(demo, { client, now: LINKED });
  });
});
