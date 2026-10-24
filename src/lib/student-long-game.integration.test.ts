import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { studentLongGameSource } from "@/lib/jane-agent/sources/student-long-game";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  StudentDatesError,
  loadStudentLongGame,
  saveStudentDates,
  syncStudentDeadlines,
} from "./student-long-game";

// Spec step 225 against a real, migrated Postgres, on the demo bank (a federal student loan of
// $18,345 at 5.25%, $195 paid each month): PSLF counted month by month, the certification and
// recertification dates as deadlines, the tax on forgiven debt, and what a refinance gives up.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "the student loan long game against a real database",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("The demo bank must never call Plaid");
        },
      },
    ) as PlaidApi;
    let tick = 0;
    const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
    const opts = (now = LINKED) => ({ client, now });
    async function person(prefix: string) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      return user.id;
    }
    async function demoPerson(prefix: string, profile: Record<string, unknown> = {}) {
      const id = await person(prefix);
      const { itemId } = await linkDemoBank(id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      if (Object.keys(profile).length) {
        await client.studentLoanProfile.create({ data: { userId: id, ...profile } });
      }
      return id;
    }

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    }, 120_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("counts PSLF from the months a payment was seen, with the forgiveness date", async () => {
      const id = await demoPerson("sl-count", { publicService: true, countedBefore: 90 });
      const g = await loadStudentLongGame(id, opts());
      expect(g.available).toBe(true);
      expect(g.pslf!.counted).toBeGreaterThan(90);
      expect(g.pslf!.counted).toBeLessThan(120);
      expect(g.pslf!.remaining).toBe(120 - g.pslf!.counted);
      expect(g.pslf!.grid).toHaveLength(13);
      expect(g.pslf!.grid.some((m) => m.state === "seen")).toBe(true);
      expect(g.pslf!.forgivenOn! > "2026-10-18").toBe(true);
      // Not in public service: nothing counted.
      const other = await demoPerson("sl-none");
      expect((await loadStudentLongGame(other, opts())).pslf).toBeNull();
    });

    it("puts the certification and recertification dates on the deadlines list, once", async () => {
      const id = await demoPerson("sl-dates", { publicService: true, countedBefore: 90 });
      await expect(
        saveStudentDates(
          id,
          { loanType: "federal", lastCertifiedOn: "not a date", recertifyOn: "" },
          opts(),
        ),
      ).rejects.toThrow(StudentDatesError);
      await saveStudentDates(
        id,
        { loanType: "federal", lastCertifiedOn: "2025-12-15", recertifyOn: "2026-11-30" },
        opts(),
      );
      const g = await loadStudentLongGame(id, opts());
      expect(g.certifyOn).toBe("2026-12-15");
      expect(g.recertifyOn).toBe("2026-11-30");
      const titles = (
        await client.deadline.findMany({ where: { userId: id }, orderBy: { dueOn: "asc" } })
      ).map((d) => [d.title, d.dueOn.toISOString().slice(0, 10)]);
      expect(titles).toContainEqual([
        "Certify your employer for Public Service Loan Forgiveness",
        "2026-12-15",
      ]);
      expect(titles).toContainEqual([
        "Recertify your income-driven student loan plan",
        "2026-11-30",
      ]);
      const before = await client.deadline.count({ where: { userId: id } });
      expect(await syncStudentDeadlines(id, opts())).toBe(0);
      expect(await client.deadline.count({ where: { userId: id } })).toBe(before);
      // A reminder inside a month of each date, once for the date.
      const snapshot = (await loadSnapshot(id, opts(new Date("2026-11-10T15:00:00Z"))))!;
      const reminders = studentLongGameSource
        .gather(snapshot, { ...context, now: new Date("2026-11-10T15:00:00Z") })
        .map((c) => c.dedupeKey);
      expect(reminders).toEqual(["student_recertify:2026-11-30"]);
    });

    it("sizes the tax on income-driven forgiveness and puts the year on the deadlines list", async () => {
      // A low income: the payment doesn't clear the loan, so the plan forgives what's left.
      const id = await demoPerson("sl-tax", {
        publicService: false,
        borrower: "new",
        agiCents: 2_500_000,
      });
      // On an income-driven plan, due to recertify in November.
      await saveStudentDates(
        id,
        { loanType: "federal", lastCertifiedOn: "", recertifyOn: "2026-11-30" },
        opts(),
      );
      const g = await loadStudentLongGame(id, opts());
      expect(g.forgiveness).not.toBeNull();
      expect(g.forgiveness!.viaPslf).toBe(false);
      expect(g.tax!.taxable).toBe(true);
      expect(g.tax!.estimateCents).toBe(Math.round(g.forgiveness!.forgivenCents * 0.22));
      expect(g.tax!.note).toContain("income-driven");
      // Forgiveness is 20 years out: the deadline waits until it's two years away.
      await syncStudentDeadlines(id, opts());
      const titles = (await client.deadline.findMany({ where: { userId: id } })).map(
        (d) => d.title,
      );
      expect(titles.some((t) => t.startsWith("Plan for tax"))).toBe(false);
      const { reply } = await sendToJane(id, "is my forgiven student loan taxed?", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(
        /forgiven around .*generally taxed as income federally from 2026.*two years before/,
      );
      expect(parseActions(reply.actions).map((a) => a.id)).toEqual(["open", "open"]);
    });

    it("never suggests refinancing a federal loan out of PSLF, and says what's lost", async () => {
      const id = await demoPerson("sl-refi", { publicService: true, countedBefore: 50 });
      const g = await loadStudentLongGame(id, opts());
      expect(g.refi!.verdict).toBe("keep");
      expect(g.refi!.lost.length).toBeGreaterThan(0);
      const { reply } = await sendToJane(id, "should I refinance my student loans?", {
        client,
        now: later(),
      });
      expect(reply.body).toContain(
        "Don't refinance a federal loan while you're counting payments for Public Service Loan Forgiveness",
      );
      expect(parseRefs(reply.refs).advice).toBe(true);
    });

    it("answers in the chat and gives Claude the same numbers", async () => {
      const id = await demoPerson("sl-chat", { publicService: true, countedBefore: 90 });
      const { reply } = await sendToJane(id, "how many PSLF payments have I made?", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(
        /^Public Service Loan Forgiveness: \d+ of 120 qualifying payments counted, \d+ to go, forgiven around /,
      );
      const tool = JSON.parse((await runChatTool(id, "student_long_game", {}, opts())).content);
      expect(tool.inPublicService).toBe(true);
      expect(tool.pslf.of).toBe(120);
      expect(tool.refinancing.whatYouWouldLose.length).toBeGreaterThan(0);
    });

    it("has nothing without a student loan, or for a real account", async () => {
      const realId = await person("sl-real");
      expect((await loadStudentLongGame(realId, opts())).available).toBe(false);
      const { reply } = await sendToJane(realId, "when will my PSLF be done", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^I don't see a student loan with a balance and a rate/);
    });
  },
);
