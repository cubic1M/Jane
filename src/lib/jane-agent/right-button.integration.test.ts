import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { ChatActionError, takeChatAction } from "./actions";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { runJaneAgent } from "./run";
import { sendToJane } from "./typing";
import { parseActions } from "./types";

// Spec step 90 against a real, migrated Postgres and the demo bank: "Why?" answers in the
// chat from the card's wording and leaves the decision open, "Set a budget" sets it through
// Budgets' code, Yes says what happens next and when, and "Remind me tomorrow" hides the
// answer until then. Each refuses another person's message.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles.
const LINKED = new Date("2026-10-18T15:00:00Z");
const at = (minutes: number) => new Date(LINKED.getTime() + minutes * 60_000);
const ids = (m: { actions: unknown }) => parseActions(m.actions).map((a) => a.id);

describe.runIf(url)("the right button against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: LINKED });
    otherId = await createCheckPerson({ client, now: LINKED });
    await runJaneAgent(userId, { client, now: LINKED, trigger: "open" });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await deleteCheckPerson(otherId, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("answers 'Why?' in the chat and leaves the decision open", async () => {
    const message = (
      await client.janeMessage.findMany({ where: { userId, kind: "decision" } })
    ).find((m) => ids(m).includes("finding.why"))!;
    await expect(
      takeChatAction(otherId, message.id, "finding.why", { client, now: at(1) }),
    ).rejects.toBeInstanceOf(ChatActionError);

    const { message: after, posted } = await takeChatAction(userId, message.id, "finding.why", {
      client,
      now: at(1),
    });
    expect(posted).toBe(true);
    expect(after.status).toBe("open");
    expect(after.actions.map((a) => a.id)).toContain("finding.yes");
    expect(after.actions.map((a) => a.id)).not.toContain("finding.why");

    const why = await client.janeMessage.findFirstOrThrow({
      where: { userId, kind: "reply", createdAt: { gt: at(1) } },
    });
    expect(why.body).toMatch(/\nIf you say yes: /);
    expect(ids(why)).toContain("finding.yes");
    expect(ids(why)).not.toContain("finding.why");
    // Nothing was decided.
    expect(await client.decision.count({ where: { userId } })).toBe(0);
  });

  it("sets a budget, prefilled, through Budgets' own code", async () => {
    const { reply } = await sendToJane(userId, "how much did I spend on food last month", {
      client,
      now: at(10),
    });
    expect(ids(reply)).toContain("budget.set");
    const budget = reply.refs.budget!;
    expect(budget.category).toBe("Food and drink");
    expect(budget.amountCents % 100).toBe(0);

    await expect(
      takeChatAction(otherId, reply.id, "budget.set", { client, now: at(11) }),
    ).rejects.toBeInstanceOf(ChatActionError);
    const { message } = await takeChatAction(userId, reply.id, "budget.set", {
      client,
      now: at(11),
    });
    expect(message.refs.note).toMatch(/^Done\. Your Food and drink budget is \$[\d,]+\.00 a month/);
    expect(await client.budget.findMany({ where: { userId } })).toEqual([
      expect.objectContaining({ category: "Food and drink", amountCents: budget.amountCents }),
    ]);
    // With a budget, it isn't offered again.
    const again = await sendToJane(userId, "how much did I spend on food last month", {
      client,
      now: at(12),
    });
    expect(ids(again.reply)).not.toContain("budget.set");
  });

  it("says what happens next after Yes, and hides an answer until tomorrow on request", async () => {
    const cancel = await sendToJane(userId, "cancel Hulu", { client, now: at(20) });
    const { message } = await takeChatAction(userId, cancel.reply.id, "finding.yes", {
      client,
      now: at(21),
    });
    expect(message.refs.note).toMatch(
      /^Got it\. I'll write to them today to cancel, and tell you here when they confirm\./,
    );

    const peacock = await sendToJane(userId, "cancel Peacock", { client, now: at(22) });
    const later = await takeChatAction(userId, peacock.reply.id, "snooze", { client, now: at(23) });
    expect(later.message).toMatchObject({
      status: "dismissed",
      answeredWith: "Remind me tomorrow",
    });
    const row = await client.janeMessage.findUniqueOrThrow({ where: { id: peacock.reply.id } });
    expect(row.snoozedUntil?.getTime()).toBeGreaterThan(at(23).getTime());
  });
});
