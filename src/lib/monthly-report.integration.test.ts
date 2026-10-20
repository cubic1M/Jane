import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { sendEmail } from "@/lib/email";
import { loadCheckIn } from "@/lib/check-in";
import { healthFor } from "@/lib/health-score";
import { answerByRules } from "@/lib/jane-agent/answer";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { rankedFor } from "@/lib/jane-agent/priorities";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { reportSource } from "@/lib/jane-agent/sources/report";
import { listTransfers } from "@/lib/money-movement/transfers";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { provenSavings } from "@/lib/savings-proof";
import { monthlyReportFor, runMonthlyReports } from "./monthly-report";

// Spec step 148 against a real, migrated Postgres, with the demo bank: in the first days
// of October, September's report is made once, every figure the same as on the page it
// links to, posted in the chat, answered when asked, and emailed once.

const url = process.env.TEST_DATABASE_URL;
// Oct 3, 8am in Los Angeles (the default timezone).
const NOW = new Date("2026-10-03T15:00:00Z");

type Email = Parameters<typeof sendEmail>[0];

describe.runIf(url)("the monthly money report", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let email: string;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    email = `report-${crypto.randomUUID()}@example.com`;
    const user = await client.user.create({ data: { email } });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    // A sample transfer that went through in September.
    const [checking, savings] = await Promise.all(
      ["checking", "savings"].map((subtype) =>
        client.account.findFirstOrThrow({ where: { userId, subtype } }),
      ),
    );
    await client.moneyTransfer.create({
      data: {
        userId,
        fromAccountId: checking.id,
        toAccountId: savings.id,
        toName: savings.name,
        amountCents: 25_000,
        purpose: "goal",
        sector: "goals",
        runOn: new Date("2026-09-16T00:00:00Z"),
        status: "completed",
        completedAt: new Date("2026-09-16T12:00:00Z"),
        partner: "stand-in",
        by: "person",
      },
    });
    await client.monthlyReport.deleteMany({ where: { userId } });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("makes last month's report once, every figure matching its page", async () => {
    const stored = (await monthlyReportFor(userId, { client, now: NOW }))!;
    expect(stored.month).toBe("2026-09");
    const { report } = stored;

    const checkIn = await loadCheckIn(userId, "2026-09", { client });
    expect(report.earnedCents).toBe(checkIn.incomeCents);
    expect(report.earnedCents).toBeGreaterThan(0);
    expect(report.paidDownCents).toBe(checkIn.debtPaymentsCents);
    expect(report.paidDownCents).toBeGreaterThan(0);
    expect(report.saved.totalCents).toBe(
      (await provenSavings(userId, { client, now: NOW })).confirmedCents,
    );
    const september = (await listTransfers(userId, { client, now: NOW })).filter(
      (t) => t.status === "completed" && t.runOn.startsWith("2026-09"),
    );
    expect(report.moved).toEqual({
      cents: september.reduce((s, t) => s + t.amountCents, 0),
      count: september.length,
    });
    expect(report.moved.cents).toBe(25_000);
    const health = (await healthFor(userId, { client, now: NOW }))!;
    expect(report.health).toMatchObject({ score: health.score, band: health.band });
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    expect(report.next?.title ?? null).toBe(rankedFor(snapshot!)[0]?.title ?? null);

    // Once.
    expect((await monthlyReportFor(userId, { client, now: NOW }))!.id).toBe(stored.id);
    expect(await client.monthlyReport.count({ where: { userId } })).toBe(1);
  });

  it("posts it in the chat, answers when asked, and tells Claude the same", async () => {
    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    const [said] = gather(snapshot!, NOW, { trigger: "open", sources: [reportSource] });
    expect(said).toMatchObject({ kind: "done", dedupeKey: "report:2026-09" });
    expect(said.body.split("\n")[0]).toBe("Your money report for September 2026 is ready.");
    expect(said.body).toContain("Moved: $250.00 in 1 transfer (sample transfers");
    expect(said.actions).toEqual([
      expect.objectContaining({ href: "/monthly?m=2026-09", label: "See September 2026" }),
    ]);
    const reply = await answerByRules(userId, { kind: "monthly_report" }, { client, now: NOW });
    expect(reply?.body).toBe(said.body);
    const tool = JSON.parse(
      (await runChatTool(userId, "monthly_report", {}, { client, now: NOW })).content,
    );
    expect(tool).toMatchObject({ month: "2026-09", moved: { transfers: 1, sampleOnly: true } });
  });

  it("emails it once, with a link for every figure", async () => {
    const send = vi.fn<(e: Email) => Promise<void>>(async () => {});
    await runMonthlyReports({ client, now: NOW, send });
    const mine = send.mock.calls.filter(([e]) => e.to === email);
    expect(mine).toHaveLength(1);
    const [sent] = mine[0];
    expect(sent.subject).toBe("Your money report for September 2026");
    expect(sent.text).toMatch(/^Earned: \$[\d,]+\.\d\d came in\. \S+\/check-in\?m=2026-09$/m);
    expect(sent.text).toMatch(/^Moved: .+ \S+\/transfers$/m);
    await runMonthlyReports({ client, now: NOW, send });
    expect(send.mock.calls.filter(([e]) => e.to === email)).toHaveLength(1);
  });

  it("isn't made after the first days of the month, or for an empty month", async () => {
    expect(
      await monthlyReportFor(userId, { client, now: new Date("2026-10-12T15:00:00Z") }),
    ).toBeNull();
    const quiet = await client.user.create({
      data: { email: `report-quiet-${crypto.randomUUID()}@example.com` },
    });
    created.push(quiet.id);
    expect(await monthlyReportFor(quiet.id, { client, now: NOW })).toBeNull();
  });
});
