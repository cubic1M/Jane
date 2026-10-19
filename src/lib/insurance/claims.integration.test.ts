import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CLAIM_GUIDES } from "@/config/claims";
import { POLICY_KINDS, type PolicyKind } from "@/config/insurance";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import {
  ClaimError,
  claimById,
  closeClaim,
  listClaims,
  markStepDone,
  saveClaimNumber,
  startClaim,
} from "./claims";
import { EMPTY_POLICY_INPUT, addPolicy } from "./policies";

// The claims helper against a real, migrated Postgres (spec step 107): it works for each
// kind of policy, and the tracker never loses a step.

const url = process.env.TEST_DATABASE_URL;
// 9am in Los Angeles.
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("the claims helper against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `ins-claim-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    return user.id;
  }
  const policyOf = (userId: string, kind: PolicyKind, carrier = "GEICO") =>
    addPolicy(userId, { ...EMPTY_POLICY_INPUT, kind, carrier }, { client });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("starts a tracker for every kind of policy and event, with the guide's steps", async () => {
    const me = await person();
    for (const kind of Object.keys(POLICY_KINDS) as PolicyKind[]) {
      const policyId = await policyOf(me, kind, `Carrier ${kind}`);
      for (const event of Object.keys(CLAIM_GUIDES[kind].events)) {
        const claim = await startClaim(
          me,
          { policyId, kind: "", event, happenedOn: "2026-10-18" },
          { client, now: NOW },
        );
        const police = ["accident", "theft", "break_in"].includes(event);
        expect(claim.steps.map((s) => s.key)).toEqual(
          CLAIM_GUIDES[kind].steps.map((s) => s.key).filter((k) => k !== "police" || police),
        );
        expect(claim).toMatchObject({ kind, event, status: "open", carrier: `Carrier ${kind}` });
        expect(claim.steps.every((s) => s.doneAt === null && s.dueOn >= "2026-10-18")).toBe(true);
      }
    }
    // Without a policy on Jane, by kind.
    const loose = await startClaim(
      me,
      { policyId: null, kind: "pet", event: "vet", happenedOn: "" },
      { client, now: NOW },
    );
    expect(loose).toMatchObject({ kind: "pet", carrier: null, happenedOn: "2026-10-19" });
  });

  it("only ever marks steps done, keeps every step, and closes when asked", async () => {
    const me = await person();
    const policyId = await policyOf(me, "auto");
    const claim = await startClaim(
      me,
      { policyId, kind: "", event: "accident", happenedOn: "" },
      { client, now: NOW },
    );
    const before = claim.steps.map((s) => s.key);
    await markStepDone(me, claim.id, "file", { client, now: NOW });
    const again = await markStepDone(me, claim.id, "file", {
      client,
      now: new Date(NOW.getTime() + DAY),
    });
    expect(again.changed).toBe(false);
    const saved = await claimById(me, claim.id, { client });
    expect(saved?.steps.map((s) => s.key)).toEqual(before);
    expect(saved?.steps.find((s) => s.key === "file")?.doneAt).toBe(NOW.toISOString());
    await expect(markStepDone(me, claim.id, "nope", { client, now: NOW })).rejects.toBeInstanceOf(
      ClaimError,
    );
    await saveClaimNumber(me, claim.id, " CLM-123 ", { client });
    await closeClaim(me, claim.id, { client, now: NOW });
    expect(await claimById(me, claim.id, { client })).toMatchObject({
      status: "closed",
      claimNumber: "CLM-123",
    });
    await expect(markStepDone(me, claim.id, "photos", { client, now: NOW })).rejects.toBeInstanceOf(
      ClaimError,
    );
    // Closed claims keep every step too.
    expect((await listClaims(me, { client }))[0].steps.map((s) => s.key)).toEqual(before);
  });

  it("refuses bad input and another person's claim or policy", async () => {
    const me = await person();
    const other = await person();
    const policyId = await policyOf(me, "home");
    const input = { policyId, kind: "", event: "break_in", happenedOn: "" };
    await expect(startClaim(other, input, { client, now: NOW })).rejects.toThrow(
      "isn't on your insurance",
    );
    await expect(
      startClaim(me, { ...input, event: "accident" }, { client, now: NOW }),
    ).rejects.toThrow("what happened");
    await expect(
      startClaim(me, { ...input, happenedOn: "2026-12-01" }, { client, now: NOW }),
    ).rejects.toThrow("future");
    const claim = await startClaim(me, input, { client, now: NOW });
    await expect(
      markStepDone(other, claim.id, "file", { client, now: NOW }),
    ).rejects.toBeInstanceOf(ClaimError);
    await expect(closeClaim(other, claim.id, { client, now: NOW })).rejects.toBeInstanceOf(
      ClaimError,
    );
  });

  it("guides from the chat, turns the message into the tracker, and reminds when a step is due", async () => {
    const me = await person();
    await policyOf(me, "auto");
    const { reply } = await sendToJane(me, "I had a car accident", { client, now: NOW });
    expect(reply.body.split("\n")[0]).toBe("I'm sorry: a car accident. Here's what to do now:");
    expect(reply.body).toContain("Your insurer: GEICO.");
    expect(reply.actions.map((a) => a.id)).toEqual(["insurance.claim_start", "open"]);

    const { message: tracker } = await takeChatAction(me, reply.id, "insurance.claim_start", {
      client,
      now: NOW,
    });
    expect(tracker.status).toBe("open");
    expect(tracker.body).toBe(
      "Your claim tracker with GEICO: a car accident on Oct 19. 0 of 6 steps done.\nNext: Get the police report number (for theft, or if anyone was hurt) (by Oct 20).",
    );
    const { message: moved } = await takeChatAction(me, tracker.id, "insurance.claim_step", {
      client,
      now: NOW,
    });
    expect(moved.body).toContain("1 of 6 steps done.\nNext: Call your insurer");
    const [claim] = await listClaims(me, { client });
    expect(claim.steps[0].doneAt).not.toBeNull();

    // Two days later the next step is due: Jane brings it up with Done.
    const later = new Date(NOW.getTime() + 2 * DAY);
    await runJaneAgent(me, { client, now: later, trigger: "open" });
    const reminder = (await client.janeMessage.findMany({ where: { userId: me } })).find((m) =>
      m.dedupeKey.startsWith(`insurance:claim:${claim.id}:file:`),
    );
    expect(reminder?.body).toMatch(/^A reminder for your claim: Your claim tracker with GEICO/);
    expect(parseRefs(reminder?.refs)).toMatchObject({ claimId: claim.id, claimStep: "file" });

    const tool = JSON.parse(
      (await runChatTool(me, "insurance_claims", {}, { client, now: later })).content,
    );
    expect(tool.claims[0]).toMatchObject({
      what: "A car accident",
      status: "open",
      insurer: "GEICO",
    });
    expect(tool.claims[0].steps[0]).toMatchObject({ done: true });
  });

  it("guides without any policy, and asks which one when only a claim is mentioned", async () => {
    const me = await person();
    const { reply } = await sendToJane(me, "someone broke into my apartment", { client, now: NOW });
    expect(reply.body).toContain("What to collect for the claim:");
    expect(reply.refs.claim).toMatchObject({ kind: "home", event: "break_in", policyId: null });
    await policyOf(me, "renters", "Lemonade");
    const { reply: ask } = await sendToJane(me, "I need to file a claim", { client, now: NOW });
    expect(ask.body).toMatch(/^I can help with that\. Which insurance is it on/);
    expect(ask.body).toContain("- Lemonade renters insurance");
    const { reply: renters } = await sendToJane(me, "someone broke into my apartment", {
      client,
      now: NOW,
    });
    expect(renters.refs.claim).toMatchObject({ kind: "renters", event: "break_in" });
    expect(renters.body).toContain("Tell your landlord");
  });
});
