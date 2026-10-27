import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The concierge flow is what's tested here (the demo bank and trial people get it); read-only
// mode for real accounts is in src/lib/decisions.integration.test.ts.
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: vi.fn(async () => true) }));

import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { listQueue } from "@/lib/concierge";
import { recordDecision } from "@/lib/decisions";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { runJob } from "@/lib/jobs";
import { readReplyByRules } from "./read-reply";
import {
  AnswerError,
  agentStep,
  answerCompany,
  canAgentWork,
  handleReply,
  runAgentFollowUps,
} from "./run";
import { simulatedBody, simulatedReply } from "./simulated-company";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
// Agent email isn't set up in tests, so the agent writes to the simulated company.
const url = process.env.TEST_DATABASE_URL;
const ADMIN = { id: "admin_1" };
const DAY = 24 * 60 * 60 * 1000;

describe.runIf(url)("the action agent against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);
  const read = (reply: { subject: string; body: string }) =>
    Promise.resolve(readReplyByRules(reply.body));

  // A person with an approved refund for a double charge; returns the action.
  async function approved(
    type: "duplicate_charge" | "insurance_reshop" = "duplicate_charge",
    { trial = false }: { trial?: boolean } = {},
  ) {
    const id = trial ? `trial_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}` : undefined;
    const user = await client.user.create({
      data: {
        ...(id ? { id } : {}),
        email: id ? `${id}@try.jane.invalid` : `agent-${crypto.randomUUID()}@example.com`,
        name: "Alex Rivera",
      },
    });
    created.push(user.id);
    const f = findingOfType(type);
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: f.type,
        key: `${f.key}-${crypto.randomUUID()}`,
        title: f.title,
        annualSavingsCents: f.annualSavingsCents,
        amountCents: f.amountCents,
        confidence: f.confidence,
        evidence: f.evidence as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const result = await recordDecision(
      user.id,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    const action = await client.action.findUniqueOrThrow({ where: { id: result.actionId! } });
    return { userId: user.id, action, result, findingId: finding.id };
  }

  const reload = (id: string) => client.action.findUniqueOrThrow({ where: { id } });
  const reply = async (actionId: string, body: string) => {
    const action = await reload(actionId);
    return handleReply(
      `reply+${action.replyToken}@agent.jane.test`,
      { from: "support@company.example", subject: "Re: your request", body },
      { client, read, notify },
    );
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });
  beforeEach(() => notify.mockClear());

  it("takes an approved refund, writes to the company, and keeps it off the team's queue", async () => {
    const { userId, action, result } = await approved();
    expect(action).toMatchObject({ agentState: "working" });
    expect(result.agentJobId).toBeTruthy();

    expect(await agentStep(userId, action.id, { client, notify })).toBe("sent");
    const after = await reload(action.id);
    expect(after).toMatchObject({ status: "in_progress", agentState: "waiting_reply" });
    const [sent] = await client.agentMessage.findMany({ where: { actionId: action.id } });
    expect(sent).toMatchObject({ direction: "outbound" });
    expect(sent.toAddress).toMatch(/simulated-support\.example$/);
    // The account holder's name goes in; the placeholders don't.
    expect(sent.body).toContain("Alex Rivera");
    expect(sent.body).not.toContain("[account holder name]");

    const queue = await listQueue(ADMIN, { type: null, status: null }, { client });
    expect(queue.map((a) => a.id)).not.toContain(action.id);
  });

  it("finishes the action when the company says it's done", async () => {
    const { userId, action, findingId } = await approved();
    await agentStep(userId, action.id, { client, notify });
    expect(await reply(action.id, simulatedBody("done", "request_refund", "Target"))).toBe("acted");
    expect(await reload(action.id)).toMatchObject({ status: "done", agentState: "finished" });
    expect((await client.finding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe(
      "done",
    );
    expect(
      await client.agentMessage.count({
        where: { actionId: action.id, direction: { in: ["outbound", "inbound"] } },
      }),
    ).toBe(2);
    expect(notify).toHaveBeenCalled();
  });

  it("asks the person when the company needs a detail, and sends their answer on", async () => {
    const { userId, action } = await approved();
    await agentStep(userId, action.id, { client, notify });
    await reply(action.id, simulatedBody("needs_info", "request_refund", "Target"));
    const waiting = await reload(action.id);
    expect(waiting.status).toBe("waiting_on_user");
    expect(waiting.userTodo).toContain("asked:");

    await expect(
      answerCompany(userId, action.id, "My card is 4111 1111 1111 1111", { client }),
    ).rejects.toBeInstanceOf(AnswerError);
    await answerCompany(userId, action.id, "The last 4 digits are 4821.", { client });
    expect(await reload(action.id)).toMatchObject({ status: "in_progress", userTodo: null });
    const last = await client.agentMessage.findFirstOrThrow({
      where: { actionId: action.id },
      orderBy: { createdAt: "desc" },
    });
    expect(last).toMatchObject({ direction: "outbound" });
    expect(last.body).toContain("4821");
  });

  it("hands a refusal to the team with the reason", async () => {
    const { userId, action } = await approved();
    await agentStep(userId, action.id, { client, notify });
    await reply(action.id, simulatedBody("refused", "request_refund", "Target"));
    const handed = await reload(action.id);
    expect(handed).toMatchObject({ status: "queued", agentState: "handed_off" });
    expect(handed.handoffReason).toContain("said no");
    const queue = await listQueue(ADMIN, { type: null, status: null }, { client });
    expect(queue.find((a) => a.id === action.id)?.handoffReason).toContain("said no");
  });

  it("doesn't promise the team to someone trying Jane, whose requests the team never works", async () => {
    const { userId, action } = await approved("duplicate_charge", { trial: true });
    await agentStep(userId, action.id, { client, notify });
    await reply(action.id, simulatedBody("refused", "request_refund", "Target"));
    const notes = await client.agentMessage.findMany({ where: { actionId: action.id } });
    const said = notes.map((n) => n.body).join("\n");
    expect(said).toMatch(/This is as far as Jane goes with sample data/);
    expect(said).not.toMatch(/Passed to our team/);
    const queue = await listQueue(ADMIN, { type: null, status: null }, { client });
    expect(queue.map((a) => a.id)).not.toContain(action.id);
  });

  it("follows up when nobody answers, then hands off", async () => {
    const { userId, action } = await approved();
    await agentStep(userId, action.id, { client, notify });
    // Waiting just as long, but left out of the run (as another test file's person would be).
    const outsider = await approved();
    await agentStep(outsider.userId, outsider.action.id, { client, notify });
    const later = (days: number) => new Date(Date.now() + days * DAY);
    const userIds = [userId];
    await runAgentFollowUps({ client, now: later(4), userIds });
    await runAgentFollowUps({ client, now: later(8), userIds });
    expect(await reload(action.id)).toMatchObject({ agentFollowUps: 2 });
    await runAgentFollowUps({ client, now: later(12), userIds });
    expect(await reload(outsider.action.id)).toMatchObject({
      agentState: "waiting_reply",
      agentFollowUps: 0,
    });
    const handed = await reload(action.id);
    expect(handed).toMatchObject({ agentState: "handed_off" });
    expect(handed.handoffReason).toContain("No reply");
    expect(
      await client.agentMessage.count({ where: { actionId: action.id, direction: "outbound" } }),
    ).toBe(3);
  });

  it("never works an action that isn't approved and open", async () => {
    const base = { agentState: "working", decision: { choice: "yes", undoneAt: null } };
    for (const status of ["done", "failed"] as const) {
      expect(canAgentWork({ ...base, status })).toBe(false);
    }
    for (const status of ["queued", "in_progress", "waiting_on_user"] as const) {
      expect(canAgentWork({ ...base, status })).toBe(true);
    }
    expect(
      canAgentWork({ ...base, status: "queued", decision: { choice: "no", undoneAt: null } }),
    ).toBe(false);
    expect(canAgentWork({ ...base, status: "queued", agentState: "handed_off" })).toBe(false);

    const { userId, action } = await approved();
    await client.action.update({ where: { id: action.id }, data: { status: "done" } });
    expect(await agentStep(userId, action.id, { client, notify })).toBe("skipped");
    expect(await client.agentMessage.count({ where: { actionId: action.id } })).toBe(0);
  });

  it("leaves the team's own kinds of action alone", async () => {
    const { action, result } = await approved("insurance_reshop");
    expect(action.agentState).toBeNull();
    expect(result.agentJobId).toBeUndefined();
  });

  it("ignores replies to addresses it doesn't know", async () => {
    expect(
      await handleReply(
        "reply+ffffffffffffffffffffffffffffffff@agent.jane.test",
        { from: "x@example.com", subject: "hi", body: "hello" },
        { client, read, notify },
      ),
    ).toBe("unknown");
  });

  it("runs the whole loop through jobs with the simulated company", async () => {
    const { action, result } = await approved();
    // The app's handlers, pointed at the test database.
    const handlers = {
      agent_step: (p: { userId: string; actionId?: string }) =>
        agentStep(p.userId, p.actionId!, { client, notify }),
      agent_simulated_reply: (p: { userId: string; actionId?: string }) =>
        simulatedReply(p.userId, p.actionId!, {
          client,
          deliver: (to, mail) => handleReply(to, mail, { client, read, notify }),
        }),
    };
    expect(await runJob(result.agentJobId!, { client, handlers })).toBe("done");
    // The simulated company's reply is the next job.
    const job = await client.job.findFirstOrThrow({
      where: { kind: "agent_simulated_reply", payload: { path: ["actionId"], equals: action.id } },
    });
    expect(await runJob(job.id, { client, handlers })).toBe("done");
    const after = await reload(action.id);
    expect(after.agentState).not.toBe("working");
    expect(
      await client.agentMessage.count({
        where: { actionId: action.id, direction: { in: ["outbound", "inbound"] } },
      }),
    ).toBe(2);
  });
});
