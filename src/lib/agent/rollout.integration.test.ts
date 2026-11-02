import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type ActionType, type DecisionSource } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setActsStopped } from "@/lib/permission/stop";
import { linkDemoBank } from "@/lib/plaid/demo";
import { grantArea } from "@/lib/standing-permission";
import { loadTimeline } from "@/lib/timeline";
import { agentStep, startAgent } from "./run";

// Stage 2 walked on the demo bank and the simulated company (AGENT_REHEARSAL=1): the rules real
// accounts would follow. Low-risk requests first, one yes per action, a rule's yes only with the area
// handed over and its hold waited out, and a hand-off comes back to the person. Against a real
// Postgres. Nothing here sends real mail: a demo person's mail mode is simulated.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const LATER = new Date("2026-10-20T15:00:00Z");

describe.runIf(url)("the agent's rollout, rehearsed", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const notify = vi.fn(async () => undefined);
  const send = vi.fn(async () => undefined);

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  beforeEach(() => vi.stubEnv("AGENT_REHEARSAL", "1"));
  afterEach(() => vi.stubEnv("AGENT_REHEARSAL", ""));

  async function withAction(type: ActionType, source: DecisionSource = "card", at = NOW) {
    const user = await client.user.create({
      data: { email: `rollout-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await linkDemoBank(user.id, { client, now: NOW });
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: "bank_fees",
        key: `k-${crypto.randomUUID()}`,
        title: "Fees",
        status: "in_progress",
        confidence: "high",
        evidence: { merchant: "Demo Bank", transactions: [], charges: [] },
      },
    });
    const decision = await client.decision.create({
      data: {
        userId: user.id,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: { title: "Fees" },
        source,
        createdAt: at,
      },
    });
    const action = await client.action.create({
      data: {
        userId: user.id,
        decisionId: decision.id,
        type,
        agentState: "working",
        status: "queued",
        replyToken: randomBytes(16).toString("hex"),
      },
    });
    return { userId: user.id, actionId: action.id };
  }
  const step = (userId: string, actionId: string, now = NOW) =>
    agentStep(userId, actionId, { client, now, send, notify });
  const row = (id: string) => client.action.findUniqueOrThrow({ where: { id } });

  it("a request past the first ones comes back to the person, with the steps", async () => {
    const { userId, actionId } = await withAction("fight_price_increase");
    expect(await step(userId, actionId)).toBe("handed_off");
    const action = await row(actionId);
    expect(action).toMatchObject({ agentState: "handed_off", status: "waiting_on_user" });
    expect(action.userTodo).toContain("Jane doesn't handle that kind of request yet");
    expect(await client.agentMessage.count({ where: { actionId, direction: "outbound" } })).toBe(0);
  });

  it("a low-risk request on a person's own yes goes ahead", async () => {
    const { userId, actionId } = await withAction("recover_bank_fees");
    const result = await step(userId, actionId);
    expect(result).not.toBe("handed_off");
    expect((await row(actionId)).agentState).not.toBe("handed_off");
  });

  it("the record shows what was sent, labelled simulated, as one entry", async () => {
    const { userId, actionId } = await withAction("recover_bank_fees");
    await step(userId, actionId);
    const acts = await client.janeAct.findMany({ where: { userId } });
    expect(acts[0]).toMatchObject({ actionId, simulated: true, specialist: "email_agent" });
    const entries = (await loadTimeline(userId, { client, now: NOW })).filter((e) =>
      e.id.includes(actionId),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ simulated: true, actId: acts[0].id });
    expect(entries[0].steps.map((s) => s.label)).toContain("Sent");
  });

  it("a rule's yes needs the area handed over", async () => {
    const { userId, actionId } = await withAction("recover_bank_fees", "rule");
    expect(await step(userId, actionId, LATER)).toBe("handed_off");
    expect((await row(actionId)).userTodo).toContain("more than you've let Jane do");
  });

  it("a rule's yes waits out its hold, so it can be taken back", async () => {
    const { userId, actionId } = await withAction("recover_bank_fees", "rule");
    await grantArea(userId, "bills", { client, now: NOW });
    expect(await step(userId, actionId, NOW)).toBe("handed_off");
    expect((await row(actionId)).userTodo).toContain("without a way to undo it");

    const held = await withAction("recover_bank_fees", "rule");
    await grantArea(held.userId, "bills", { client, now: NOW });
    expect(await step(held.userId, held.actionId, LATER)).not.toBe("handed_off");
  });

  it("startAgent holds a rule's yes for the undo window", async () => {
    const { userId, actionId } = await withAction("recover_bank_fees", "rule");
    await client.action.updateMany({ where: { id: actionId }, data: { agentState: null } });
    await startAgent(userId, actionId, { client, now: NOW, source: "rule" });
    const action = await row(actionId);
    expect(action.agentNextAt).toEqual(new Date(NOW.getTime() + 24 * 3_600_000));
  });

  it("the stop-all switch pauses it, and nothing is sent", async () => {
    const { userId, actionId } = await withAction("recover_bank_fees");
    await setActsStopped(userId, true, { client, now: NOW });
    expect(await step(userId, actionId)).toBe("waiting");
    expect(await client.agentMessage.count({ where: { actionId, direction: "outbound" } })).toBe(0);
    expect((await row(actionId)).agentState).toBe("waiting_reply");
    expect(send).not.toHaveBeenCalled();
  });
});
