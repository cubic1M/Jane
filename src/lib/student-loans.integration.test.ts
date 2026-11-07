import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { STUDENT_STEPS } from "@/config/student-loans";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { StudentProfileError, loadStudentLoans, saveStudentProfile } from "./student-loans";

// Spec step 114 against a real, migrated Postgres, on the demo bank: the student loan's
// plans compared at an income from the paychecks (or the one the person gives), Jane's pick
// labelled, qualifying payments counted from the payments to the servicer, and
// studentaid.gov's steps walked one at a time in the chat, each with its official page.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("student loans against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const opts = (now = LINKED) => ({ client, now });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `student-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("compares the plans at an income from the paychecks, and counts payments", async () => {
    const data = await loadStudentLoans(userId, opts());
    expect(data.loan?.name).toBe("Demo Student Loan ····0005");
    expect(data.agiFrom).toBe("paychecks");
    expect(data.agiCents).toBeGreaterThan(5_000_000);
    expect(data.comparison!.results.map((r) => r.plan)).toEqual([
      "current",
      "standard",
      "ibr",
      "rap",
    ]);
    expect(data.comparison!.pick).not.toBeNull();
    // A payment a month to Nelnet over the last year.
    expect(data.paymentsSeen).toBeGreaterThanOrEqual(12);
    expect(data.paymentsCounted).toBe(data.paymentsSeen);
    expect(data.countingToward).toEqual({ name: "IBR forgiveness", needed: 240 });
  });

  it("uses what the person gives, and counts toward PSLF in public service", async () => {
    await saveStudentProfile(
      userId,
      {
        agi: "45000",
        familySize: "2",
        dependants: "1",
        borrower: "new",
        publicService: true,
        countedBefore: "60",
      },
      opts(),
    );
    const data = await loadStudentLoans(userId, opts());
    expect(data).toMatchObject({ agiCents: 4_500_000, agiFrom: "you" });
    expect(data.paymentsCounted).toBe(60 + data.paymentsSeen);
    expect(data.countingToward).toEqual({ name: "Public Service Loan Forgiveness", needed: 120 });
    expect(data.comparison!.pick!.why[0]).toMatch(/^In public service, the lowest payment wins/);
    await expect(
      saveStudentProfile(
        userId,
        {
          agi: "lots",
          familySize: "1",
          dependants: "0",
          borrower: "new",
          publicService: false,
          countedBefore: "0",
        },
        opts(),
      ),
    ).rejects.toThrow(StudentProfileError);
  });

  it("answers by rules, labelled, with the next official step", async () => {
    const { reply } = await sendToJane(userId, "which student loan plan should I be on?", opts());
    expect(reply.body).toContain("Your Demo Student Loan ····0005: $18,345.00 at 5.25%.");
    expect(reply.body).toContain("- Repayment Assistance Plan (RAP): ");
    expect(reply.body).toMatch(
      /qualifying payments counted toward Public Service Loan Forgiveness/,
    );
    expect(reply.refs.advice).toBe(true);
    expect(reply.actions[0]).toMatchObject({ href: STUDENT_STEPS[0].url });
  });

  it("walks studentaid.gov's steps in one message, each with its official page", async () => {
    const snapshot = await loadSnapshot(userId, opts());
    const steps = gather(snapshot!, LINKED, { trigger: "sync" }).find(
      (m) => m.dedupeKey === "student:steps",
    )!;
    expect(steps.body.split("\n")[0]).toBe("Student loans, step 1 of 5: See your federal loans.");
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: steps.kind,
        body: steps.body,
        refs: steps.refs,
        actions: steps.actions,
        dedupeKey: steps.dedupeKey,
      },
    });
    let current = message.id;
    for (let i = 1; i < STUDENT_STEPS.length; i += 1) {
      const { message: next } = await takeChatAction(userId, current, "student.next", opts());
      expect(next.status).toBe("open");
      expect(next.body).toContain(`step ${i + 1} of 5: ${STUDENT_STEPS[i].title}`);
      expect(
        next.actions.find((a) => a.kind === "link" && a.href === STUDENT_STEPS[i].url),
      ).toBeTruthy();
      current = next.id;
    }
    const { message: last } = await takeChatAction(userId, current, "student.next", opts());
    expect(last.status).toBe("answered");
    expect(last.body).toMatch(/^That's every step on studentaid\.gov done/);
    expect((await loadStudentLoans(userId, opts())).profile.stepsDone).toBe(STUDENT_STEPS.length);
  });

  // Debugger 11-06: a teacher's six months of statements, two paychecks a month, read as a year's
  // pay ($26,572), so IBR came out $22 a month.
  it("paces under a year of paychecks to a year", async () => {
    const user = await client.user.create({
      data: { email: `student-half-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    const days = [5, 6, 7, 8, 9, 10].flatMap((m) =>
      [15, 30].map((d) => `2026-${String(m).padStart(2, "0")}-${d}`),
    );
    await client.transaction.createMany({
      data: [...days, "2026-05-01"].map((d, i) => ({
        userId: user.id,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `pay-${i}`,
        date: new Date(`${d}T00:00:00Z`),
        amountCents: i < days.length ? -221_437 : 138_500,
        description: i < days.length ? "SPRINGFIELD SCH DIST PAYROLL" : "PINE HOLLOW APTS RENT",
        pfcPrimary: i < days.length ? "INCOME" : "RENT_AND_UTILITIES",
        pfcDetailed: i < days.length ? "INCOME_SALARY" : "RENT_AND_UTILITIES_RENT",
        categorySource: "rule" as const,
      })),
    });
    const data = await loadStudentLoans(user.id, opts(new Date("2026-11-06T18:00:00Z")));
    expect(data.agiFrom).toBe("paychecks");
    // $26,572.44 over May 1 to October 30, 183 days: about $53,000 a year.
    expect(data.agiCents).toBe(Math.round((2_657_244 * 365) / 183));
  });

  it("gives Claude the plans, the count and the official pages", async () => {
    const tool = await runChatTool(userId, "student_loans", {}, opts());
    const output = JSON.parse(tool.content);
    expect(output.steps).toHaveLength(STUDENT_STEPS.length);
    expect(
      output.steps.every((s: { officialPage: string }) =>
        s.officialPage.startsWith("https://studentaid.gov/"),
      ),
    ).toBe(true);
    expect(output.sources.servicerPlans).toMatch(/studentaid\.gov/);
    expect(tool.cents).toContain(1_834_500);
  });
});
