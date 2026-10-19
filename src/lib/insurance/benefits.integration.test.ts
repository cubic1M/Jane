import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { workEnrollmentDeadlines } from "@/lib/deadlines";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import {
  answerQuestion,
  benefitsFromPayroll,
  confirmBenefit,
  declineBenefit,
  listBenefits,
} from "./benefits";
import { compareBenefits, enrollmentReview } from "./benefits-review";
import { latestCheckup } from "./checkups";
import { listPolicies } from "./policies";

// Benefits through work against a real, migrated Postgres (spec step 150): deductions read
// from the stand-in pay stubs count only once confirmed; the guided questions fill in the
// rest; each benefit is compared like for like with buying privately; and Jane's
// recommendation is ready before open enrollment at work.

const url = process.env.TEST_DATABASE_URL;
// 9am in Los Angeles; ACME's open enrollment runs Nov 2–13.
const NOW = new Date("2026-10-25T16:00:00Z");

describe.runIf(url)("benefits through work against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(demo = true) {
    const user = await client.user.create({
      data: { email: `ins-ben-${crypto.randomUUID()}@example.com` },
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
    const checking = await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-10-15T00:00:00Z"),
        amountCents: -245_000,
        description: "ACME CORP PAYROLL",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_SALARY",
      },
    });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("finds benefits on the pay stub, counting none until confirmed, and never one declined", async () => {
    const me = await person();
    expect(await benefitsFromPayroll(me, { client, now: NOW })).toBe(7);
    expect(await benefitsFromPayroll(me, { client, now: NOW })).toBe(0);
    const found = await listBenefits(me, { client });
    expect(found.map((b) => [b.kind, b.perPayCents, b.status])).toEqual([
      ["health", 14_500, "found"],
      ["dental", 1_200, "found"],
      ["vision", 400, "found"],
      ["life", 850, "found"],
      ["disability", 620, "found"],
      ["hsa", 10_000, "found"],
      ["fsa", 5_000, "found"],
    ]);
    expect(await listPolicies(me, { client })).toEqual([]);

    const life = found.find((b) => b.kind === "life")!;
    await confirmBenefit(me, life.id, { client });
    const [policy] = await listPolicies(me, { client });
    expect(policy).toMatchObject({
      kind: "life",
      carrier: "ACME CORP",
      source: "employer",
      status: "active",
      premiumCents: 1_700,
      premiumFrequency: "monthly",
      coverage: { deathBenefit: 8_640_000 },
    });
    await declineBenefit(me, found.find((b) => b.kind === "fsa")!.id, { client });
    expect(await benefitsFromPayroll(me, { client, now: NOW })).toBe(0);
    // Someone else can't confirm them.
    const other = await person();
    await expect(confirmBenefit(other, found[0].id, { client })).rejects.toThrow();
  });

  it("reads nothing for real accounts: only the guided questions", async () => {
    const real = await person(false);
    expect(await benefitsFromPayroll(real, { client, now: NOW })).toBe(0);
    await answerQuestion(real, "life", "none", { client, now: NOW });
    await answerQuestion(real, "disability", "yes", { client, now: NOW });
    const [policy] = await listPolicies(real, { client });
    expect(policy).toMatchObject({ kind: "disability", source: "employer", premiumCents: 0 });
  });

  it("confirms in the chat with one tap, then asks the guided questions in the same message", async () => {
    const me = await person();
    await benefitsFromPayroll(me, { client, now: NOW });
    await runJaneAgent(me, { client, now: NOW, trigger: "open" });
    const asked = (await client.janeMessage.findMany({ where: { userId: me } })).find((m) =>
      m.dedupeKey.startsWith("insurance:benefits:"),
    );
    expect(asked?.body.split("\n")[0]).toBe("I found 7 benefits on your ACME CORP pay stub.");
    await takeChatAction(me, asked!.id, "benefits.confirm_all", { client, now: NOW });
    expect((await listBenefits(me, { client })).every((b) => b.status === "confirmed")).toBe(true);
    // Health, dental, vision, life and disability are cover; HSA and FSA are accounts.
    expect((await listPolicies(me, { client })).map((p) => p.kind).sort()).toEqual([
      "disability",
      "health",
      "life",
      "other",
      "other",
    ]);

    await runJaneAgent(me, { client, now: new Date(NOW.getTime() + 86_400_000), trigger: "open" });
    const question = (await client.janeMessage.findMany({ where: { userId: me } })).find(
      (m) => parseRefs(m.refs).benefitQuestion === "life",
    );
    expect(question?.body).toMatch(/^One question about your job: does it give you life insurance/);
    const { message } = await takeChatAction(me, question!.id, "benefits.life_2x", {
      client,
      now: NOW,
    });
    // The stub shows disability already: nothing more to ask.
    expect(message).toMatchObject({ status: "answered", answeredWith: "Yes, 2× my pay" });
    const lives = (await listPolicies(me, { client })).filter((p) => p.kind === "life");
    expect(lives.map((p) => Number(p.coverage.deathBenefit)).sort((a, b) => a - b)).toEqual([
      8_640_000, 17_280_000,
    ]);
  });

  it("compares like for like, gets the recommendation ready before open enrollment, and answers", async () => {
    const me = await person();
    await benefitsFromPayroll(me, { client, now: NOW });
    const life = (await listBenefits(me, { client })).find((b) => b.kind === "life")!;
    await confirmBenefit(me, life.id, { client });
    const [comparison] = await compareBenefits(me, { client, now: NOW });
    expect(comparison).toMatchObject({ throughWorkCents: 20_400, note: null });
    expect(comparison.privateCents).toBeGreaterThan(0);

    expect(await enrollmentReview(me, { client, now: new Date("2026-10-10T16:00:00Z") })).toBe(
      false,
    );
    expect(await enrollmentReview(me, { client, now: NOW })).toBe(true);
    expect(await enrollmentReview(me, { client, now: NOW })).toBe(false);
    const review = await latestCheckup(me, { client });
    expect(review?.reason).toBe("enrollment");
    expect(review?.recommendations[0].title).toMatch(/life insurance/);

    const deadlines = await workEnrollmentDeadlines(me, { client, now: NOW });
    expect(deadlines.map((d) => [d.date, d.title])).toEqual([
      ["2026-11-02", "Open enrollment at ACME CORP starts"],
      ["2026-11-13", "Last day of open enrollment at ACME CORP"],
    ]);

    const { reply } = await sendToJane(me, "what benefits do I get through work", {
      client,
      now: NOW,
    });
    expect(reply.body.split("\n")[0]).toBe(
      "You have 1 benefit through work on file, and 6 I found on your pay stub to confirm.",
    );
    expect(reply.body).toContain("Open enrollment at ACME CORP runs Nov 2, 2026 to Nov 13, 2026");
    expect(reply.refs.advice).toBe(true);
    const tool = JSON.parse(
      (await runChatTool(me, "insurance_benefits", {}, { client, now: NOW })).content,
    );
    expect(tool.openEnrollmentAtWork).toEqual({
      employer: "ACME CORP",
      start: "2026-11-02",
      end: "2026-11-13",
    });
  });
});
