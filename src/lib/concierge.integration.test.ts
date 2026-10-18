import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { findingOfType } from "./__fixtures__/findings";
import { CARD_SELECT, buildCard, cardHash } from "./cards";
import { ConciergeError, changeActionStatus, getActionForAdmin, listQueue } from "./concierge";
import { recordDecision } from "./decisions";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const ADMIN = { id: "admin_1", email: "team@example.com" };

describe.runIf(url)("concierge actions against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  const email = `concierge-${crypto.randomUUID()}@example.com`;
  const notify = vi.fn();

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email } })).id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  beforeEach(() => {
    notify.mockReset();
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
  });

  let sequence = 0;
  async function approvedAction() {
    // A kind the team always works by hand (the agent's kinds skip the queue).
    const f = findingOfType("insurance_reshop");
    sequence += 1;
    const finding = await client.finding.create({
      data: {
        userId,
        type: f.type,
        key: `${f.key}-${sequence}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: { ...CARD_SELECT, status: true },
    });
    const { actionId } = await recordDecision(
      userId,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    return { actionId: actionId as string, findingId: finding.id };
  }

  const base = {
    assignee: "sam",
    notes: null,
    minutesSpent: null,
    userTodo: null,
    failureReason: null,
  };

  it("moves an action through its statuses, keeping the finding in step and emailing the person", async () => {
    const { actionId, findingId } = await approvedAction();

    await changeActionStatus(
      ADMIN,
      actionId,
      { ...base, status: "in_progress" },
      { client, notify },
    );
    await changeActionStatus(
      ADMIN,
      actionId,
      { ...base, status: "waiting_on_user", userTodo: "Forward Netflix's confirmation email" },
      { client, notify },
    );
    await changeActionStatus(
      ADMIN,
      actionId,
      { ...base, status: "done", minutesSpent: 12 },
      { client, notify },
    );

    const action = await client.action.findUniqueOrThrow({ where: { id: actionId } });
    expect(action).toMatchObject({
      status: "done",
      minutesSpent: 12,
      assignee: "sam",
      userTodo: null,
    });
    expect(action.startedAt).not.toBeNull();
    expect(action.completedAt).not.toBeNull();
    expect((await client.finding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe(
      "done",
    );

    expect(notify.mock.calls.map(([to, mail]) => [to, mail.subject])).toEqual([
      [email, expect.stringMatching(/^We're working on it/)],
      [email, expect.stringMatching(/^We need something from you/)],
      [email, expect.stringMatching(/^Done/)],
    ]);
    expect(notify.mock.calls[1][1].lines).toContain("Forward Netflix's confirmation email");
    expect(
      vi
        .mocked(track)
        .mock.calls.map((c) => c[1])
        .filter((e) => e.startsWith("action_")),
    ).toEqual(["action_started", "action_waiting", "action_done"]);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "action_status_changed",
      { type: "action", id: actionId },
      { from: "waiting_on_user", to: "done", user_id: userId },
    );
  });

  it("refuses to close without minutes or fail without a reason, changing nothing", async () => {
    const { actionId } = await approvedAction();

    await expect(
      changeActionStatus(ADMIN, actionId, { ...base, status: "done" }, { client, notify }),
    ).rejects.toBeInstanceOf(ConciergeError);
    await expect(
      changeActionStatus(
        ADMIN,
        actionId,
        { ...base, status: "failed", minutesSpent: 5 },
        { client, notify },
      ),
    ).rejects.toThrow(/why it failed/);

    expect((await client.action.findUniqueOrThrow({ where: { id: actionId } })).status).toBe(
      "queued",
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps the status change when the email fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    notify.mockRejectedValue(new Error("Resend down"));
    const { actionId } = await approvedAction();

    await changeActionStatus(
      ADMIN,
      actionId,
      { ...base, status: "in_progress" },
      { client, notify },
    );

    expect((await client.action.findUniqueOrThrow({ where: { id: actionId } })).status).toBe(
      "in_progress",
    );
  });

  it("lists open actions oldest first and audit-logs every view", async () => {
    const { actionId } = await approvedAction();

    const queue = await listQueue(ADMIN, { type: "insurance_reshop", status: null }, { client });
    expect(queue.map((a) => a.id)).toContain(actionId);
    const created = queue.map((a) => a.createdAt.getTime());
    expect(created).toEqual([...created].sort((a, b) => a - b));
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "admin_viewed_queue",
      null,
      expect.any(Object),
    );

    const detail = await getActionForAdmin(ADMIN, actionId, { client });
    expect(detail?.user.email).toBe(email);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "admin_viewed_action",
      { type: "action", id: actionId },
      { user_id: userId },
    );
  });

  it("assigns actions, logs who moved them, and filters the queue by assignee", async () => {
    const { actionId } = await approvedAction();
    const change = {
      status: "in_progress" as const,
      assignee: "sam@example.com",
      notes: null,
      userTodo: null,
      failureReason: null,
      minutesSpent: null,
    };
    await changeActionStatus(ADMIN, actionId, change, { client, notify });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: ADMIN.id },
      "action_assigned",
      { type: "action", id: actionId },
      { from: null, to: "sam@example.com" },
    );

    vi.mocked(logAudit).mockClear();
    await changeActionStatus(ADMIN, actionId, change, { client, notify });
    expect(vi.mocked(logAudit).mock.calls.map(([, event]) => event)).not.toContain(
      "action_assigned",
    );

    const sams = await listQueue(
      ADMIN,
      { type: null, status: null, assignee: "sam@example.com" },
      { client },
    );
    expect(sams.map((a) => a.id)).toContain(actionId);
    const unassigned = await listQueue(
      ADMIN,
      { type: null, status: null, assignee: "unassigned" },
      { client },
    );
    expect(unassigned.map((a) => a.id)).not.toContain(actionId);
  });
});
