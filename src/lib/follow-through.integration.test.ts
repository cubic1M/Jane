import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { NUDGE_AFTER_DAYS, NUDGE_MAX } from "@/config/follow-through";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { addDays } from "@/lib/dates";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { raiseAlerts } from "./alerts";
import { runDigests } from "./digest/send";
import { loadFollowUps, runFollowThrough as runIt, stillFollowingUp } from "./follow-through";
import { declineFollowUp, markFollowUpDone } from "./follow-through-answers";
import { takeChatAction } from "./jane-agent/actions";
import { runJaneAgent } from "./jane-agent/run";
import { closeAnsweredElsewhere } from "./jane-agent/settled";
import { recordAnswer, savingsRecord, verifyOutcomes } from "./outcomes";
import { answerSuggestion } from "./suggestions";

// Following through on a Yes against a real, migrated Postgres: it stays open until later data
// settles it, a person who did nothing is nudged until they act or say no, a fix that failed comes
// back with the next step while a clean no stays final, and a trial person gets none of it.

// Alerts as they are, with no real email.
const send = vi.fn();
const raise: typeof raiseAlerts = (userId, alerts, options) =>
  raiseAlerts(userId, alerts, { ...options, send, push: vi.fn(async () => 0) });
const runFollowThrough = (userId: string, options: Parameters<typeof runIt>[1]) =>
  runIt(userId, { raise, ...options });

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T15:00:00Z`);
const HULU = {
  kind: "charge_stops" as const,
  payees: [{ description: "HULU 877-8244858", amountCents: 1_799, perYear: 12 }],
};
const ANSWERED = "2026-06-10";

describe.runIf(url)("following through on a Yes", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person(id?: string) {
    const user = await client.user.create({
      data: { ...(id ? { id } : {}), email: `follow-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const charge = (date: string, description: string, amountCents: number) =>
      client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          date: new Date(`${date}T00:00:00Z`),
          description,
          amountCents,
          pfcPrimary: "ENTERTAINMENT",
        },
      });
    return { userId: user.id, accountId: account.id, charge };
  }

  async function yes(
    userId: string,
    { key = "subscriptions:hulu", watch = HULU as object | null, on = ANSWERED } = {},
  ) {
    await client.suggestion.create({
      data: {
        userId,
        key,
        capability: "subscriptions",
        topic: "subscription_review",
        title: "Cancel Hulu",
        worthCents: 21_588,
        worthKind: "saves",
        confidencePercent: 90,
        confidenceReason: "twelve charges",
        urgency: "normal",
        why: "You pay for it.",
        actionLabel: "Show me how",
        actionHref: "/spending",
        ...(watch ? { watch } : {}),
      },
    });
    await answerSuggestion(userId, key, "yes", { client, now: at(on) });
    return key;
  }

  const row = (userId: string, key: string) =>
    client.suggestionOutcome.findFirstOrThrow({ where: { userId, suggestionKey: key } });
  const alertsOf = (userId: string) =>
    client.alert.findMany({ where: { userId, type: "follow_up" }, orderBy: { key: "asc" } });

  it("a Yes with no newer statement stays open past its window, never 'not seen'", async () => {
    const { userId, charge } = await person();
    await charge("2026-05-20", "HULU 877-8244858", 1_799);
    const key = await yes(userId);
    const months = at(addDays(ANSWERED, 200));
    await verifyOutcomes(userId, { client, now: months });
    expect((await row(userId, key)).status).toBe("open");
    const record = await savingsRecord(userId, { client, now: months });
    expect(record.notSeen).toEqual([]);
    expect(record.expected[0]).toMatchObject({ open: true, state: "said_yes" });
    expect(record.expected[0].checkWords).toContain("once a statement after");
  });

  it("settles when a later statement finally comes, even months later", async () => {
    const { userId, charge } = await person();
    await charge("2026-05-20", "HULU 877-8244858", 1_799);
    const key = await yes(userId);
    await charge("2026-11-20", "GROCERY", 3_000);
    await verifyOutcomes(userId, { client, now: at("2026-12-20") });
    const after = await row(userId, key);
    expect(after.status).toBe("confirmed");
    expect(after.proof).toContain("nothing since");
  });

  it("a Yes nothing can verify says what settles it", async () => {
    const { userId } = await person();
    const key = await yes(userId, { watch: null });
    const record = await savingsRecord(userId, { client, now: at("2026-07-01") });
    expect((await row(userId, key)).status).toBe("unverifiable");
    expect(record.expected[0]).toMatchObject({ open: true });
    expect(record.expected[0].settles).toContain("Open until you mark it done");
  });

  it("nudges someone who did nothing, up to the cap, through the alerts and the dock", async () => {
    const { userId } = await person();
    const key = await yes(userId);
    const early = await runFollowThrough(userId, { client, now: at(addDays(ANSWERED, 1)) });
    expect(early.nudged).toBe(0);
    expect(await alertsOf(userId)).toEqual([]);
    expect(await loadFollowUps(userId, { client, now: at(addDays(ANSWERED, 1)) })).toEqual([]);

    const first = at(addDays(ANSWERED, NUDGE_AFTER_DAYS));
    expect((await runFollowThrough(userId, { client, now: first })).nudged).toBe(1);
    const [alert] = await alertsOf(userId);
    expect(alert).toMatchObject({ key: `nudge:${key}:1`, urgent: false, confidencePercent: 100 });
    expect(alert.body).toContain('You said yes to "Cancel Hulu" on Jun 10');
    const [card] = await loadFollowUps(userId, { client, now: first });
    expect(card).toMatchObject({ key, kind: "nudge", round: 1, href: "/spending" });

    // Run again the same night: nothing new.
    expect((await runFollowThrough(userId, { client, now: first })).nudged).toBe(0);
    // And it doesn't go past the cap, however long it's left.
    for (const days of [30, 60, 90, 120]) {
      await runFollowThrough(userId, { client, now: at(addDays(ANSWERED, days)) });
    }
    expect((await row(userId, key)).nudgeCount).toBe(NUDGE_MAX);
    expect(await alertsOf(userId)).toHaveLength(NUDGE_MAX);
  });

  it("stops when they act, and the alert stops being news", async () => {
    const { userId } = await person();
    const key = await yes(userId);
    const night = at(addDays(ANSWERED, NUDGE_AFTER_DAYS));
    await runFollowThrough(userId, { client, now: night });
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "heads_up",
        body: "x",
        refs: { followUp: key, followUpRound: 1, followUpKind: "nudge" },
        actions: [],
        dedupeKey: `followup:nudge:${key}:1`,
        priority: 1,
        status: "open",
      },
    });
    const alertKey = `nudge:${key}:1`;
    expect((await stillFollowingUp(userId, [alertKey], { client })).has(alertKey)).toBe(true);

    await markFollowUpDone(userId, key, { client, now: at(addDays(ANSWERED, 8)) });

    expect((await stillFollowingUp(userId, [alertKey], { client })).has(alertKey)).toBe(false);
    expect(await loadFollowUps(userId, { client, now: at(addDays(ANSWERED, 8)) })).toEqual([]);
    await closeAnsweredElsewhere(userId, { client, now: at(addDays(ANSWERED, 8)) });
    expect((await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      "answered",
    );
    const later = await runFollowThrough(userId, { client, now: at(addDays(ANSWERED, 40)) });
    expect(later.nudged).toBe(0);
    expect((await alertsOf(userId))[0].readAt).not.toBeNull();
  });

  it("reaches the weekly email while it stands, and not once it's done", async () => {
    const { userId, charge } = await person();
    await charge("2026-06-15", "GROCERY", 3_000);
    const key = await yes(userId);
    const night = at(addDays(ANSWERED, NUDGE_AFTER_DAYS));
    await runFollowThrough(userId, { client, now: night });
    const preview = async () => {
      const run = await runDigests({ client, now: night, dryRun: true, userIds: [userId] });
      return run.previews.find((p) => p.userId === userId)?.text ?? "";
    };
    expect(await preview()).toContain("Still to do: Cancel Hulu");
    await markFollowUpDone(userId, key, { client, now: night });
    expect(await preview()).not.toContain("Still to do: Cancel Hulu");
  });

  it("stops when they say no, for good", async () => {
    const { userId } = await person();
    const key = await yes(userId);
    await runFollowThrough(userId, { client, now: at(addDays(ANSWERED, NUDGE_AFTER_DAYS)) });
    await declineFollowUp(userId, key, { client, now: at(addDays(ANSWERED, 8)) });
    expect(await row(userId, key)).toMatchObject({ status: "declined", answer: "no" });
    expect((await client.suggestion.findFirstOrThrow({ where: { userId, key } })).status).toBe(
      "no",
    );
    expect(await loadFollowUps(userId, { client, now: at(addDays(ANSWERED, 40)) })).toEqual([]);
    const later = await runFollowThrough(userId, { client, now: at(addDays(ANSWERED, 40)) });
    expect(later).toMatchObject({ nudged: 0, cameBack: 0 });
  });

  it("a fix that failed is told once, with what the data showed and the next step", async () => {
    const { userId, charge } = await person();
    await charge("2026-05-20", "HULU 877-8244858", 1_799);
    const key = await yes(userId);
    await charge("2026-06-20", "HULU 877-8244858", 1_799);
    const night = at(addDays(ANSWERED, 80));
    await verifyOutcomes(userId, { client, now: night });
    const failed = await row(userId, key);
    expect(failed.status).toBe("not_seen");
    expect(failed.failedAt).not.toBeNull();

    expect((await runFollowThrough(userId, { client, now: night })).cameBack).toBe(1);
    // A nudge from before it failed stops being news; the failure is what's said now.
    const held = await stillFollowingUp(userId, [`nudge:${key}:1`, `failed:${key}:1`], { client });
    expect([...held]).toEqual([`failed:${key}:1`]);
    const [alert] = (await alertsOf(userId)).filter((a) => a.key.startsWith("failed:"));
    expect(alert.key).toBe(`failed:${key}:1`);
    expect(alert.body).toContain("Still charged: $17.99 on Jun 20");
    expect(alert.body).toContain("Next: Check your account with them");

    // Told once, however many nights it's checked.
    await verifyOutcomes(userId, { client, now: at(addDays(ANSWERED, 81)) });
    expect(
      (await runFollowThrough(userId, { client, now: at(addDays(ANSWERED, 81)) })).cameBack,
    ).toBe(0);
    expect((await row(userId, key)).failedAt).toEqual(failed.failedAt);
  });

  it("a Yes again after a failure watches from then", async () => {
    const { userId, charge } = await person();
    await charge("2026-05-20", "HULU 877-8244858", 1_799);
    const key = await yes(userId);
    await charge("2026-06-20", "HULU 877-8244858", 1_799);
    await verifyOutcomes(userId, { client, now: at(addDays(ANSWERED, 80)) });
    await runFollowThrough(userId, { client, now: at(addDays(ANSWERED, 80)) });

    const again = at(addDays(ANSWERED, 90));
    await recordAnswer(userId, key, "yes", { client, now: again });
    expect(await row(userId, key)).toMatchObject({
      status: "open",
      failedAt: null,
      proof: null,
      comebacks: 1,
      nudgeCount: 0,
    });
    expect((await row(userId, key)).answeredAt).toEqual(again);
  });

  it("a trial person has no nudges, comebacks, statement asks or dock cards", async () => {
    const { userId, charge } = await person(`${TRIAL_ID_PREFIX}${crypto.randomUUID()}`);
    await charge("2026-05-20", "HULU 877-8244858", 1_799);
    await yes(userId);
    const later = at(addDays(ANSWERED, 90));
    const raise = vi.fn();
    expect(await runFollowThrough(userId, { client, now: later, raise })).toEqual({
      nudged: 0,
      cameBack: 0,
      asked: false,
    });
    expect(raise).not.toHaveBeenCalled();
    expect(await loadFollowUps(userId, { client, now: later })).toEqual([]);
  });

  it("asks an upload-only person for the new statement once a cycle, and stops after a new one", async () => {
    const { userId, charge } = await person();
    await charge("2026-09-30", "GROCERY", 3_000);
    const before = await runFollowThrough(userId, { client, now: at("2026-10-20") });
    expect(before.asked).toBe(false);

    const due = at("2026-11-03");
    expect((await runFollowThrough(userId, { client, now: due })).asked).toBe(true);
    const asks = () => client.alert.findMany({ where: { userId, type: "statement_due" } });
    expect(await asks()).toHaveLength(1);
    expect((await asks())[0]).toMatchObject({ urgent: true });
    expect((await asks())[0].title).toContain("Checking");
    // Same cycle: the same ask, not a second one.
    await runFollowThrough(userId, { client, now: at("2026-11-10") });
    expect(await asks()).toHaveLength(1);

    await charge("2026-11-02", "GROCERY", 3_000);
    expect((await runFollowThrough(userId, { client, now: at("2026-11-12") })).asked).toBe(false);
    expect((await asks())[0].readAt).not.toBeNull();
  });
});

// The dock: the card reaches the person when they open the chat, and its buttons work.
describe.runIf(url)("a follow-up in the dock", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function nudged() {
    const user = await client.user.create({
      data: { email: `dock-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        date: at(addDays(ANSWERED, 8)),
        description: "GROCERY",
        amountCents: 3_000,
      },
    });
    const key = "subscriptions:hulu";
    await client.suggestion.create({
      data: {
        userId: user.id,
        key,
        capability: "subscriptions",
        topic: "subscription_review",
        title: "Cancel Hulu",
        worthCents: 21_588,
        worthKind: "saves",
        confidencePercent: 90,
        confidenceReason: "twelve charges",
        urgency: "normal",
        why: "You pay for it.",
        actionLabel: "Show me how",
        actionHref: "/spending",
        watch: HULU,
      },
    });
    await answerSuggestion(user.id, key, "yes", { client, now: at(ANSWERED) });
    await runIt(user.id, { client, now: at(addDays(ANSWERED, NUDGE_AFTER_DAYS)), raise });
    return { userId: user.id, key };
  }
  const card = (userId: string, key: string) =>
    client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { contains: `followup:nudge:${key}:1` } },
    });

  it("posts when they open the chat, once, with its own buttons", async () => {
    const { userId, key } = await nudged();
    const now = at(addDays(ANSWERED, NUDGE_AFTER_DAYS));
    await runJaneAgent(userId, { client, now, trigger: "open" });
    const message = await card(userId, key);
    expect(message.body).toContain('You said yes to "Cancel Hulu"');
    // Its own card, not folded behind the morning's agenda with no buttons to tap.
    expect(message.snoozedUntil).toBeNull();
    expect(message.status).toBe("open");
    expect((message.actions as { id: string }[]).map((a) => a.id)).toEqual([
      "followup.done",
      "snooze",
      "followup.no",
      "open",
    ]);
    await runJaneAgent(userId, { client, now, trigger: "open" });
    expect(
      await client.janeMessage.count({ where: { userId, dedupeKey: { contains: "followup:" } } }),
    ).toBe(1);
  });

  it("I did it stops the nudges, and the card is answered", async () => {
    const { userId, key } = await nudged();
    const now = at(addDays(ANSWERED, NUDGE_AFTER_DAYS));
    await runJaneAgent(userId, { client, now, trigger: "open" });
    const message = await card(userId, key);
    await takeChatAction(userId, message.id, "followup.done", { client, now });
    expect((await card(userId, key)).status).toBe("answered");
    const row = await client.suggestionOutcome.findFirstOrThrow({
      where: { userId, suggestionKey: key },
    });
    expect(row.doneAt).toEqual(now);
    expect((await runIt(userId, { client, now: at(addDays(ANSWERED, 40)), raise })).nudged).toBe(0);
  });

  it("Not for me is final", async () => {
    const { userId, key } = await nudged();
    const now = at(addDays(ANSWERED, NUDGE_AFTER_DAYS));
    await runJaneAgent(userId, { client, now, trigger: "open" });
    await takeChatAction(userId, (await card(userId, key)).id, "followup.no", { client, now });
    expect(
      await client.suggestionOutcome.findFirstOrThrow({ where: { userId, suggestionKey: key } }),
    ).toMatchObject({ status: "declined", answer: "no" });
    expect(await loadFollowUps(userId, { client, now: at(addDays(ANSWERED, 40)) })).toEqual([]);
  });
});
