import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { canFile, draftClaim, fileClaim, refreshClaimStatuses } from "./claim-filing";
import { ClaimError, claimById, startClaim } from "./claims";
import { NegotiationError, callCarrier, listNegotiations, negotiationsDue } from "./negotiate";
import { EMPTY_POLICY_INPUT, listPolicies, updatePolicy } from "./policies";

// Renewal negotiation and claims, done by Jane, against a real, migrated Postgres (spec step
// 155): a renewal going up is called about only on the tap or within the person's autopilot
// limits, with the reshop alongside; a small claim is filed only after the person has seen
// the draft, and its status is tracked in the chat.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("renewal calls and claims done by Jane, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const opts = () => ({ client, now: NOW });

  async function person(demo = true) {
    const user = await client.user.create({
      data: { email: `ins-jane-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (demo) {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: "v1:unused",
        },
      });
    }
    const account = await client.account.create({
      data: {
        userId: user.id,
        source: demo ? "plaid" : "csv",
        name: "Card",
        type: "credit",
        subtype: "credit card",
      },
    });
    return { userId: user.id, accountId: account.id };
  }

  // GEICO car insurance at $142 a month, now charging $170.
  async function rising(userId: string, accountId: string) {
    const policy = await client.insurancePolicy.create({
      data: {
        userId,
        kind: "auto",
        carrier: "GEICO",
        source: "payments",
        status: "active",
        premiumCents: 14_200,
        premiumFrequency: "monthly",
        merchantKey: "geico",
        coverage: { bodilyInjuryPerPerson: 5_000_000, collision: true },
        deductibleCents: 50_000,
        renewalDate: new Date(NOW.getTime() + 20 * DAY),
      },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId,
        source: "plaid",
        date: new Date(NOW.getTime() - 3 * DAY),
        amountCents: 17_000,
        description: "GEICO *AUTO",
        merchantName: "GEICO",
        pfcPrimary: "GENERAL_SERVICES",
        pfcDetailed: "GENERAL_SERVICES_INSURANCE",
      },
    });
    return policy;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("asks before calling about a renewal going up, then calls on the tap", async () => {
    const { userId: me, accountId } = await person();
    const policy = await rising(me, accountId);
    const [asked, ...rest] = await negotiationsDue(me, opts());
    expect(rest).toEqual([]);
    expect(asked).toMatchObject({
      status: "asked",
      currentAnnualCents: 170_400,
      renewalAnnualCents: 204_000,
      calledBy: null,
    });
    // The reshop ran alongside.
    expect(await client.insuranceShop.count({ where: { userId: me, policyId: policy.id } })).toBe(
      1,
    );
    expect(await negotiationsDue(me, opts())).toEqual([]);

    const called = await callCarrier(me, asked.id, opts());
    expect(called.status).toBe("lowered");
    expect(called.calledBy).toBe("you");
    expect(called.offer).toBe("a higher deductible for a lower price");
    const [after] = await listPolicies(me, opts());
    expect(after.premiumCents).toBe(Math.round(called.resultAnnualCents! / 12));
    // The cover the carrier offered to change was never taken.
    expect(after).toMatchObject({ deductibleCents: 50_000 });
    await expect(callCarrier(me, asked.id, opts())).rejects.toThrow(NegotiationError);
  });

  it("finds the rise on a policy found from payments once it's confirmed", async () => {
    // Gap audit: Progressive at $118 a month for months, then $131. The policy found from the
    // payments holds $131, so only its history shows the rise; and confirming it must make it
    // active, or it's never checked.
    const { userId: me, accountId } = await person();
    const found = await client.insurancePolicy.create({
      data: {
        userId: me,
        kind: "auto",
        carrier: "Progressive",
        source: "payments",
        status: "found",
        premiumCents: 13_100,
        premiumFrequency: "monthly",
        merchantKey: "progressive",
      },
    });
    for (const [daysAgo, cents] of [
      [100, 11_800],
      [70, 11_800],
      [40, 13_100],
      [10, 13_100],
    ] as const) {
      await client.transaction.create({
        data: {
          userId: me,
          accountId,
          source: "plaid",
          date: new Date(NOW.getTime() - daysAgo * DAY),
          amountCents: cents,
          description: "PROGRESSIVE AUTO",
          merchantName: "Progressive",
          pfcPrimary: "GENERAL_SERVICES",
          pfcDetailed: "GENERAL_SERVICES_INSURANCE",
        },
      });
    }
    expect(await negotiationsDue(me, opts())).toEqual([]);
    await updatePolicy(
      me,
      found.id,
      {
        ...EMPTY_POLICY_INPUT,
        kind: "auto",
        carrier: "Progressive",
        premium: "131",
        premiumFrequency: "monthly",
      },
      opts(),
    );
    expect((await listPolicies(me, opts()))[0].status).toBe("active");
    const [asked] = await negotiationsDue(me, opts());
    expect(asked).toMatchObject({
      status: "asked",
      currentAnnualCents: 141_600,
      renewalAnnualCents: 157_200,
    });
  });

  it("calls by itself only within the person's autopilot limits", async () => {
    const within = await person();
    await rising(within.userId, within.accountId);
    await setAutopilot(within.userId, "all", opts());
    await setSectorAutopilot(
      within.userId,
      "insurance",
      { level: "all", actionCapCents: 10_000, monthlyCapCents: 50_000 },
      opts(),
    );
    const [done] = await negotiationsDue(within.userId, opts());
    expect(done).toMatchObject({ status: "lowered", calledBy: "autopilot" });

    const over = await person();
    await rising(over.userId, over.accountId);
    await setAutopilot(over.userId, "all", opts());
    // A monthly rise of about $28 is over a $20 action cap: ask first.
    await setSectorAutopilot(
      over.userId,
      "insurance",
      { level: "all", actionCapCents: 2_000 },
      opts(),
    );
    const [asked] = await negotiationsDue(over.userId, opts());
    expect(asked).toMatchObject({ status: "asked", calledBy: null });
  });

  it("calls from the chat with one tap, and answers about it", async () => {
    const { userId: me, accountId } = await person();
    await rising(me, accountId);
    await negotiationsDue(me, opts());
    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const message = (await client.janeMessage.findMany({ where: { userId: me } })).find(
      (m) => parseRefs(m.refs).negotiationId,
    );
    expect(message?.body).toMatch(
      /^Your GEICO car policy renews at \$2,040\.00 a year, up from \$1,704\.00\. Want me to call GEICO/,
    );
    const { message: answered } = await takeChatAction(me, message!.id, "renewal.call", opts());
    expect(answered).toMatchObject({ status: "answered", answeredWith: "Call them" });
    expect(parseRefs(answered.refs).note).toMatch(
      /^I called GEICO: they'll renew your GEICO car policy at/,
    );
    const { reply } = await sendToJane(me, "haggle with my insurer", opts());
    expect(reply.body).toMatch(/^I called GEICO/);
    const tool = JSON.parse((await runChatTool(me, "insurance_negotiations", {}, opts())).content);
    expect(tool.negotiations).toEqual([
      expect.objectContaining({ status: "lowered", atRenewal: "$2,040.00", calledBy: "you" }),
    ]);
  });

  it("files a small claim only after the draft, and tracks it to paid in the chat", async () => {
    const { userId: me, accountId } = await person();
    const policy = await rising(me, accountId);
    const claim = await startClaim(
      me,
      { policyId: policy.id, kind: "auto", event: "accident", happenedOn: "2026-10-17" },
      opts(),
    );
    expect(await canFile(me, claim, opts())).toBe(true);
    // Nothing to file without a draft the person has seen.
    await expect(fileClaim(me, claim.id, opts())).rejects.toThrow(ClaimError);
    await expect(
      draftClaim(
        me,
        claim.id,
        { amount: "5000", description: "Backed into a pole in a car park." },
        opts(),
      ),
    ).rejects.toThrow("Jane files claims up to $2,500.00");
    const draft = await draftClaim(
      me,
      claim.id,
      { amount: "900", description: "Backed into a pole in a car park; the bumper is dented." },
      opts(),
    );
    expect(draft).toMatchObject({ filing: "draft", amountCents: 90_000, claimNumber: null });

    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const message = (await client.janeMessage.findMany({ where: { userId: me } })).find((m) =>
      m.dedupeKey.includes("claim-draft"),
    );
    expect(message?.body.split("\n")[0]).toBe(
      "Here's the claim I'd file with GEICO. Nothing goes until you tap File it.",
    );
    await takeChatAction(me, message!.id, "claim.file", opts());
    const filed = (await claimById(me, claim.id, opts()))!;
    expect(filed).toMatchObject({ filing: "filed", carrierStatus: "received" });
    expect(filed.claimNumber).toMatch(/^DEMO-CLM-/);
    expect(filed.steps.find((s) => s.key === "file")?.doneAt).not.toBeNull();
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: me },
      "insurance_claim_filed",
      { type: "insurance_claim", id: claim.id },
      { kind: "auto", amount_cents: 90_000 },
    );

    const later = new Date(NOW.getTime() + 11 * DAY);
    expect(
      (await refreshClaimStatuses(me, { client, now: later })).map((c) => c.carrierStatus),
    ).toEqual(["paid"]);
    const paid = (await claimById(me, claim.id, opts()))!;
    // $900 less the $500 deductible.
    expect(paid).toMatchObject({ status: "closed", carrierStatus: "paid", payoutCents: 40_000 });
    await runJaneAgent(me, { client, now: later, trigger: "open" });
    const news = (await client.janeMessage.findMany({ where: { userId: me } })).find((m) =>
      m.dedupeKey.includes(`claim-status:${claim.id}:paid`),
    );
    expect(news?.body).toBe(
      `GEICO paid your claim (number ${filed.claimNumber}). They paid $400.00, so I've closed the claim.`,
    );
  });

  it("does neither without a partner: real accounts", async () => {
    const { userId: me, accountId } = await person(false);
    const policy = await rising(me, accountId);
    expect(await negotiationsDue(me, opts())).toEqual([]);
    expect(await listNegotiations(me, opts())).toEqual([]);
    const claim = await startClaim(
      me,
      { policyId: policy.id, kind: "auto", event: "accident", happenedOn: "2026-10-17" },
      opts(),
    );
    expect(await canFile(me, claim, opts())).toBe(false);
    await expect(
      draftClaim(
        me,
        claim.id,
        { amount: "900", description: "Backed into a pole in a car park." },
        opts(),
      ),
    ).rejects.toThrow(ClaimError);
  });
});
