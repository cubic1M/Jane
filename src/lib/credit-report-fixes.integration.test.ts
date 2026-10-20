import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { reportFixesSource } from "@/lib/jane-agent/sources/credit-report-fixes";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  CreditFixError,
  loadReportFixes,
  refreshReportFixes,
  sendReportLetter,
} from "./credit-report-fixes";

// Spec step 181 against a real, migrated Postgres, on the demo bank (a stand-in report with
// a medical collection and an error): letters citing the rule and deadline from config,
// sent only on a tap and once, the answer dates on the deadlines list, the stand-in's
// answers followed up in the chat, and nothing for a real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "collections and report errors against a real database",
  { timeout: 30_000 },
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
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, name: "Sam Rivera" },
      });
      created.push(user.id);
      return user.id;
    }
    async function demoPerson(prefix: string) {
      const id = await person(prefix);
      const { itemId } = await linkDemoBank(id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
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

    it("finds the collection and the error through the credit partner, with letters ready", async () => {
      const id = await demoPerson("fix-find");
      const data = await loadReportFixes(id, opts());
      expect(data.available).toBe(true);
      expect(data.fixes.map((f) => f.item.kind).sort()).toEqual(["collection", "error"]);
      const collection = data.fixes.find((f) => f.item.kind === "collection")!;
      expect(collection.letters.map((l) => l.kind)).toEqual(["validation", "dispute"]);
      const validation = collection.letters[0];
      // The notice came 12 days before Jane first looked (Oct 18): 18 days left in the window.
      expect(validation.windowEndsOn).toBe("2026-11-05");
      expect(validation.body).toContain("Fair Debt Collection Practices Act");
      expect(validation.body).toContain("$742.00");
      expect(validation.body.endsWith("Sincerely,\nSam Rivera")).toBe(true);
      expect(validation.answerByIfSentToday).toBe("2026-11-17");
      const dispute = data.fixes.find((f) => f.item.kind === "error")!.letters[0];
      expect(dispute.body).toContain("Fair Credit Reporting Act");
      expect(dispute.answerByIfSentToday).toBe("2026-11-17");
    });

    it("brings the collection up first, with the window, and sends nothing itself", async () => {
      const id = await demoPerson("fix-chat");
      const snapshot = (await loadSnapshot(id, opts()))!;
      const [first] = reportFixesSource
        .gather(snapshot, context)
        .filter((c) => c.dedupeKey.startsWith("reportfix:"));
      expect(first.kind).toBe("decision");
      expect(first.body).toMatch(
        /^Your credit report shows a collection from Northstar Recovery for \$742\.00\./,
      );
      expect(first.body).toContain("You have until Nov 5, 2026 to ask for validation.");
      expect(first.body).toContain("nothing is sent until you tap");
      expect(first.actions[0]).toMatchObject({ id: "creditfix.send" });
      expect(await client.creditDispute.count({ where: { userId: id } })).toBe(0);
    });

    it("sends a letter on a tap, once, audited, with the answer date on the deadlines list", async () => {
      const id = await demoPerson("fix-send");
      const { reply } = await sendToJane(id, "there's a collection on my credit report", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^I found 2 things on your credit report that may need fixing\./);
      expect(parseActions(reply.actions)[0].id).toBe("creditfix.send");
      const tapped = await takeChatAction(id, reply.id, "creditfix.send", { client, now: later() });
      expect(tapped.message.refs.note).toMatch(
        /^Sent\. The collector must answer by Nov 1\d, 2026; it's on your deadlines/,
      );
      const rows = await client.creditDispute.findMany({ where: { userId: id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "validation",
        itemKind: "collection",
        status: "sent",
        partner: "demo",
      });
      const deadline = await client.deadline.findFirstOrThrow({ where: { userId: id } });
      expect(deadline.title).toBe("Collector's validation due: Northstar Recovery");
      expect(deadline.dueOn.toISOString().slice(0, 10)).toBe(
        rows[0].deadlineOn.toISOString().slice(0, 10),
      );
      expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
        { type: "user", id },
        "credit_dispute_sent",
        expect.objectContaining({ type: "credit_dispute" }),
        expect.objectContaining({ kind: "validation" }),
      );
      await expect(
        sendReportLetter(id, "validation:demo-collection-northstar", opts()),
      ).rejects.toThrow(CreditFixError);
      await expect(sendReportLetter(id, "dispute:nothing", opts())).rejects.toThrow(CreditFixError);
    });

    it("won't send a validation letter after its 30 days", async () => {
      const id = await demoPerson("fix-late");
      const late = new Date(LINKED.getTime() + 25 * DAY);
      await expect(
        sendReportLetter(id, "validation:demo-collection-northstar", opts(late)),
      ).rejects.toThrow(/deadline to ask for validation has passed/);
      expect(await client.creditDispute.count({ where: { userId: id } })).toBe(0);
    });

    it("follows up in the chat when the answer comes, and marks the deadline done", async () => {
      const id = await demoPerson("fix-answer");
      await sendReportLetter(id, "dispute:demo-error-late-card", opts());
      expect(await refreshReportFixes(id, opts())).toBe(0);
      const after = new Date(LINKED.getTime() + 4 * DAY);
      expect(await refreshReportFixes(id, opts(after))).toBe(1);
      const row = await client.creditDispute.findFirstOrThrow({ where: { userId: id } });
      expect(row).toMatchObject({ status: "resolved", removed: true });
      expect(row.outcome).toMatch(/^Corrected:/);
      expect(
        (await client.deadline.findFirstOrThrow({ where: { userId: id } })).doneAt,
      ).not.toBeNull();
      const data = await loadReportFixes(id, opts(after));
      expect(data.fixes.find((f) => f.item.kind === "error")!.fixed).toBe(true);
      const snapshot = (await loadSnapshot(id, opts(after)))!;
      const answer = reportFixesSource
        .gather(snapshot, { ...context, now: after })
        .find((c) => c.dedupeKey === `reportfix_answer:${row.id}`);
      expect(answer!.kind).toBe("done");
      expect(answer!.body).toContain("Demo Credit Card answered your dispute");
      const tool = JSON.parse(
        (await runChatTool(id, "credit_report_fixes", {}, opts(after))).content,
      );
      expect(tool.alwaysNeedsATap).toBe("sending any letter");
      expect(tool.standIn).toBe(true);
    });

    it("never checks or sends anything for a real account", async () => {
      const realId = await person("fix-real");
      expect((await loadReportFixes(realId, opts())).available).toBe(false);
      await expect(sendReportLetter(realId, "dispute:x", opts())).rejects.toThrow(CreditFixError);
      const { reply } = await sendToJane(realId, "fix my credit report", { client, now: later() });
      expect(reply.body).toMatch(
        /^Checking your credit report for collections and errors needs a credit partner/,
      );
      expect(await client.creditDispute.count({ where: { userId: realId } })).toBe(0);
    });
  },
);
