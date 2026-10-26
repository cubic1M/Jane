import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadDebts } from "./debts";
import {
  LoanApplicationError,
  acceptLoan,
  listApplications,
  prepareApplication,
  refreshLoanApplications,
  submitApplication,
  withdrawApplication,
} from "./loan-applications";

// Spec step 112 against a real, migrated Postgres, on the demo bank: "Apply" on Jane's
// refinance pick prepares the application from what it knows, the terms are reviewed
// before anything is sent, the stand-in lender approves on a soft check, the person
// accepts, the lender funds it, the demo bank shows the old loan at zero, and Jane
// confirms the payoff and counts the new loan.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(LINKED.getTime() + days * DAY);
const HARBOR = "Harbor Auto Refi";

describe.runIf(url)("one-tap apply against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let itemId: string;
  let carKey: string;
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

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, name: "Sam Demo" },
    });
    created.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await person("apply-demo");
    ({ itemId } = await linkDemoBank(userId, { client, now: LINKED }));
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    carKey = (await loadDebts(userId, opts())).debts.find((d) => d.kind === "auto")!.key;
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("applies from the chat: Apply shows the terms, Submit sends them, Accept signs", async () => {
    const { reply } = await sendToJane(userId, "Can I refinance my car loan?", opts());
    expect(reply.actions[0]).toEqual({
      id: "loan.prepare",
      label: `Apply with ${HARBOR}`,
      kind: "primary",
    });
    expect(reply.refs.refinance).toEqual({ debtKey: carKey, lender: HARBOR });

    const prepared = await takeChatAction(userId, reply.id, "loan.prepare", opts());
    expect(prepared.message.status).toBe("open");
    expect(prepared.message.body.split("\n")[0]).toBe(
      `Here's the application I prepared for ${HARBOR}. Check the terms before you submit:`,
    );
    expect(prepared.message.body).toContain("- Pays off: your Demo Car Loan ····0006, $18,020.00");
    expect(prepared.message.actions.map((a) => a.label)).toEqual([
      "Submit the application",
      "Don't apply",
      "Review it in full",
    ]);
    const [app] = await listApplications(userId, opts());
    expect(app).toMatchObject({
      status: "draft",
      lender: HARBOR,
      oldName: "Demo Car Loan ····0006",
      applicant: {
        name: "Sam Demo",
        payingOff: "Demo Car Loan ····0006",
        amountCents: 1_802_000,
      },
    });
    // Nothing has been sent yet.
    expect(app.submittedAt).toBeNull();

    const submitted = await takeChatAction(userId, reply.id, "loan.submit", opts());
    expect(submitted.message.refs.note).toMatch(/^Harbor Auto Refi approved you on these terms\./);
    expect(submitted.message.actions.map((a) => a.id)).toEqual([
      "loan.accept",
      "loan.withdraw",
      "open",
    ]);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "loan_application_submitted",
      { type: "loan_application", id: app.id },
      { lender: HARBOR, product: "auto", status: "approved" },
    );

    const accepted = await takeChatAction(userId, reply.id, "loan.accept", opts());
    expect(accepted.message.refs.note).toMatch(
      /^Accepted\. Harbor Auto Refi pays off your Demo Car Loan/,
    );
    expect((await listApplications(userId, opts()))[0].status).toBe("accepted");
  });

  it("follows it on its own: funded, then the old loan at zero, then the new loan counted", async () => {
    expect(await refreshLoanApplications(userId, opts(later(1)))).toEqual({
      funded: 0,
      paidOff: 0,
    });
    // The stand-in lender funds three days after acceptance; the bank hasn't synced yet.
    expect(await refreshLoanApplications(userId, opts(later(3)))).toEqual({
      funded: 1,
      paidOff: 0,
    });
    let snapshot = await loadSnapshot(userId, opts(later(3)));
    const funded = gather(snapshot!, later(3), { trigger: "sync" }).filter(
      (m) => m.source === "loans",
    );
    expect(funded.map((m) => m.dedupeKey)).toEqual([expect.stringMatching(/^loans:funded:/)]);

    // The demo bank's next sync shows the car loan at zero (it ran Jane, who confirmed it).
    await syncItem(itemId, { client, api: plaid, now: later(4) });
    const car = await client.account.findFirstOrThrow({ where: { userId, subtype: "auto" } });
    expect(car.currentBalanceCents).toBe(0);
    const [app] = await listApplications(userId, opts());
    expect(app.status).toBe("paid_off");
    expect(app.paidOffAt).not.toBeNull();

    snapshot = await loadSnapshot(userId, opts(later(4)));
    const [paid] = gather(snapshot!, later(4), { trigger: "sync" }).filter(
      (m) => m.source === "loans",
    );
    expect(paid.body).toMatch(
      /^Your Demo Car Loan ····0006 is paid off: your bank shows it at zero\./,
    );

    const book = await loadDebts(userId, opts(later(4)));
    const newLoan = book.debts.find((d) => d.name === `${HARBOR} loan`)!;
    expect(newLoan).toMatchObject({
      kind: "auto",
      balanceCents: 1_802_000,
      aprFrom: "accepted",
      inNetWorth: false,
    });
    expect(book.newLoansOwedCents).toBe(1_802_000);
    const owe = await sendToJane(userId, "how much do I owe", opts(later(4)));
    expect(owe.reply.body).toContain(`on your new ${HARBOR} loan, from the terms you accepted`);
  });

  it("answers where the application stands, for rules and for Claude", async () => {
    const { reply } = await sendToJane(userId, "how's my loan application", opts(later(5)));
    expect(reply.body).toContain(`- ${HARBOR}, paying off your Demo Car Loan ····0006`);
    expect(reply.body).toContain("Done: your Demo Car Loan ····0006 is paid off.");
    const tool = await runChatTool(userId, "loan_applications", {}, opts(later(5)));
    expect(JSON.parse(tool.content).applications[0]).toMatchObject({
      lender: HARBOR,
      status: "paid_off",
      sample: true,
    });
    expect(tool.cents).toContain(1_802_000);
  });

  it("never sends without the terms reviewed, and only one at a time per debt", async () => {
    const student = (await loadDebts(userId, opts())).debts.find((d) => d.kind === "student")!;
    const app = await prepareApplication(
      userId,
      { debtKey: student.key, lender: "Maple Student Refi" },
      opts(),
    );
    await expect(submitApplication(userId, app.id, { reviewed: false }, opts())).rejects.toThrow(
      "Review the terms before you apply.",
    );
    // Preparing again replaces the draft.
    const again = await prepareApplication(
      userId,
      { debtKey: student.key, lender: "Maple Student Refi" },
      opts(),
    );
    expect(
      (await listApplications(userId, opts())).filter((a) => a.status === "draft"),
    ).toHaveLength(1);
    await submitApplication(userId, again.id, { reviewed: true }, opts());
    await expect(
      prepareApplication(userId, { debtKey: student.key, lender: "Cedar Learning Loans" }, opts()),
    ).rejects.toThrow("You're already applying with Maple Student Refi for this one.");
    await withdrawApplication(userId, again.id, opts());
    await expect(acceptLoan(userId, again.id, opts())).rejects.toThrow(LoanApplicationError);
  });

  it("is the person's own, and needs a lending partner", async () => {
    const otherId = await person("apply-other");
    const [app] = await listApplications(userId, opts());
    await expect(acceptLoan(otherId, app.id, opts())).rejects.toThrow("isn't there anymore");
    await expect(
      prepareApplication(otherId, { debtKey: carKey, lender: HARBOR }, opts()),
    ).rejects.toThrow("There's no lending partner for your accounts yet.");
  });
});
