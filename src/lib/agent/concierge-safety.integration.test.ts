import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/concierge-mode", () => ({
  conciergeMode: vi.fn(async () => true),
  onSampleDataOnly: vi.fn(async () => false),
}));

import { AGENT_MAX_AUTO_ANSWERS } from "@/config/agent";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { ConciergeError, changeActionStatus } from "@/lib/concierge";
import { recordDecision } from "@/lib/decisions";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { handleCallResult } from "@/lib/voice/calls";
import type { CallResult } from "@/lib/voice/provider";
import { readReplyByRules } from "./read-reply";
import { AnswerError, agentStep, answerCompany, handleReply } from "./run";
import { simulatedBody } from "./simulated-company";

// What the agent does for someone when what it hears is repeated, sent at once, or comes from
// someone else, against a real Postgres. Concierge is off for real accounts today, so these protect
// sample-data people now and real accounts the day it's on.

const url = process.env.TEST_DATABASE_URL;
const ADMIN = { id: "admin_1", email: "team@example.com" };

describe.runIf(url)(
  "the agent, when what it hears isn't what it seems",
  { timeout: 60_000 },
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const notify = vi.fn(async () => undefined);
    const read = vi.fn((reply: { subject: string; body: string }) =>
      Promise.resolve(readReplyByRules(reply.body)),
    );
    const deliver = vi.fn(async () => undefined);

    beforeAll(() => {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    });
    beforeEach(() => {
      notify.mockClear();
      read.mockClear();
      deliver.mockClear();
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
    });

    // An approved request for a person, of the kind given; the agent's first step not yet run.
    async function approved(type: "duplicate_charge" | "bill_negotiation" = "duplicate_charge") {
      const user = await client.user.create({
        data: { email: `safety-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
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
      const { actionId } = await recordDecision(
        user.id,
        { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
        { client },
      );
      return {
        userId: user.id,
        actionId: actionId!,
        evidence: f.evidence as { monthlyCents?: number },
      };
    }

    // The same, with the first email sent: the address Jane wrote to, and a way to reply to it.
    async function waiting() {
      const { userId, actionId } = await approved();
      await agentStep(userId, actionId, { client, notify });
      const action = await reload(actionId);
      const { toAddress } = await client.agentMessage.findFirstOrThrow({
        where: { actionId, direction: "outbound" },
      });
      const reply = (body: string, from = toAddress) =>
        handleReply(
          `reply+${action.replyToken}@agent.jane.test`,
          { from, subject: "Re: your request", body },
          { client, read, notify, send: deliver },
        );
      return { userId, actionId, toAddress, reply };
    }

    // What a company says, as the simulated company words it.
    const DONE = simulatedBody("done", "request_refund", "Target");
    const ASKS = simulatedBody("needs_info", "request_refund", "Target");

    const reload = (id: string) => client.action.findUniqueOrThrow({ where: { id } });
    const outbound = (actionId: string) =>
      client.agentMessage.count({ where: { actionId, direction: "outbound" } });

    it("acts only on a reply from the company Jane wrote to, and reads nothing else", async () => {
      const { actionId, reply } = await waiting();
      expect(await reply(DONE, "help@not-the-company.example")).toBe("kept");
      expect(read).not.toHaveBeenCalled();
      expect(await reload(actionId)).toMatchObject({ status: "in_progress" });
      // Kept on the timeline, for the team to see.
      expect(
        await client.agentMessage.count({
          where: { actionId, direction: "inbound", fromAddress: "help@not-the-company.example" },
        }),
      ).toBe(1);
      expect(await reply(DONE)).toBe("acted");
      expect(await reload(actionId)).toMatchObject({ status: "done" });
    });

    it("acts on the same reply once, whether it comes twice or twice at once", async () => {
      const { actionId, reply } = await waiting();
      // A question Jane answers itself, which leaves it waiting again: delivered a second time, it
      // used to send the person's details a second time.
      const question = "Could you confirm the email on the account?";
      expect(await reply(question)).toBe("acted");
      const answered = await outbound(actionId);
      expect(await reply(question)).toBe("kept");
      expect(await outbound(actionId)).toBe(answered);

      notify.mockClear();
      const results = await Promise.all([reply(DONE), reply(DONE)]);
      expect(results.toSorted()).toEqual(["acted", "kept"]);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it("answers the company's questions itself only a few times, then asks the person", async () => {
      const { actionId, reply } = await waiting();
      for (let i = 0; i < AGENT_MAX_AUTO_ANSWERS; i += 1) {
        await reply(`Could you confirm the email on the account? (${i})`);
        expect(await reload(actionId)).toMatchObject({ status: "in_progress" });
      }
      const before = await outbound(actionId);
      await reply("Could you confirm the email on the account one more time?");
      expect(await outbound(actionId)).toBe(before);
      expect(await reload(actionId)).toMatchObject({ status: "waiting_on_user" });
    });

    it("sends the person's answer once when it's sent several times at once", async () => {
      const { userId, actionId, reply } = await waiting();
      await reply(ASKS);
      expect(await reload(actionId)).toMatchObject({ status: "waiting_on_user" });
      const before = await outbound(actionId);
      // Each from its own connection, as two serverless instances would be.
      const others = Array.from(
        { length: 6 },
        () => new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) }),
      );
      const results = await Promise.allSettled(
        others.map((other) =>
          answerCompany(userId, actionId, "The basic plan.", { client: other }),
        ),
      );
      await Promise.all(others.map((other) => other.$disconnect()));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AnswerError);
      }
      expect(await outbound(actionId)).toBe(before + 1);
    });

    it("won't sign advice or a link with Jane's name", async () => {
      const { userId, actionId, reply } = await waiting();
      await reply(ASKS);
      for (const answer of [
        "The basic plan. Also, you should buy Tesla stock.",
        "The basic plan, see https://evil.example/claim",
      ]) {
        await expect(answerCompany(userId, actionId, answer, { client })).rejects.toBeInstanceOf(
          AnswerError,
        );
      }
      expect(await reload(actionId)).toMatchObject({ status: "waiting_on_user" });
    });

    it("sends the first email once when two steps run at once", async () => {
      const { userId, actionId } = await approved();
      const steps = await Promise.all([
        agentStep(userId, actionId, { client, notify }),
        agentStep(userId, actionId, { client, notify }),
      ]);
      expect(steps.toSorted()).toEqual(["sent", "waiting"]);
      expect(await outbound(actionId)).toBe(1);
    });

    it("doesn't follow up before one is due", async () => {
      const { userId, actionId } = await waiting();
      expect(await agentStep(userId, actionId, { client, notify })).toBe("waiting");
      expect(await outbound(actionId)).toBe(1);
    });

    // A bill negotiation, its call placed.
    async function called() {
      const { userId, actionId, evidence } = await approved("bill_negotiation");
      await agentStep(userId, actionId, { client, notify });
      const action = await reload(actionId);
      const result = (over: Partial<CallResult>): CallResult => ({
        outcome: "lowered",
        transcript: "Provider: done.",
        newMonthlyCents: null,
        offer: null,
        ...over,
      });
      return { userId, action, monthly: evidence.monthlyCents!, result };
    }

    it("takes a call's result once when it comes twice at once", async () => {
      const { action, monthly, result } = await called();
      notify.mockClear();
      const outcomes = await Promise.all(
        [1, 2].map(() =>
          handleCallResult(action.replyToken!, result({ newMonthlyCents: monthly - 1_000 }), {
            client,
            notify,
          }),
        ),
      );
      expect(outcomes.toSorted()).toEqual(["acted", "kept"]);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(await reload(action.id)).toMatchObject({
        status: "done",
        confirmedAnnualCents: 1_000 * 12,
      });
    });

    it("doesn't count a whole bill as saved because a call says it went to nothing", async () => {
      const { action, result } = await called();
      await handleCallResult(action.replyToken!, result({ newMonthlyCents: 0 }), {
        client,
        notify,
      });
      expect(await reload(action.id)).toMatchObject({
        status: "queued",
        agentState: "handed_off",
        confirmedAnnualCents: null,
      });
    });

    it("applies a team member's status change once, and the agent stops writing", async () => {
      const { actionId } = await waiting();
      notify.mockClear();
      const change = {
        status: "done" as const,
        assignee: null,
        notes: null,
        minutesSpent: 5,
        userTodo: null,
        failureReason: null,
      };
      const results = await Promise.allSettled([
        changeActionStatus(ADMIN, actionId, change, { client, notify }),
        changeActionStatus(ADMIN, actionId, change, { client, notify }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(ConciergeError);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(await reload(actionId)).toMatchObject({
        status: "done",
        agentState: "handed_off",
        agentNextAt: null,
      });
    });
  },
);
