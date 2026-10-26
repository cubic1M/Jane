import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { IdentityError, loadIdentity, markHavePin, markStep, openCase } from "@/lib/tax-identity";
import { confirmTaxNotice, readTaxNotice } from "@/lib/tax-notices";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 218 against a real, migrated Postgres: the January IP PIN reminder, and each
// sign of tax identity theft opening a case whose steps are tracked to done.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const JAN = new Date("2027-01-12T16:00:00Z");

describe.runIf(url)(
  "a protected tax identity against a real database",
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

    async function person(prefix: string) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      return user.id;
    }
    const gather = async (userId: string, now: Date) =>
      taxesSource.gather((await loadSnapshot(userId, { client, now }))!, {
        now,
        local: { date: now.toISOString().slice(0, 10), hour: 8 },
        trigger: "open",
      });
    async function post(userId: string, dedupeKeyStart: string, now: Date) {
      const c = (await gather(userId, now)).find((x) => x.dedupeKey.startsWith(dedupeKeyStart));
      expect(c, dedupeKeyStart).toBeDefined();
      return {
        c: c!,
        message: await client.janeMessage.create({
          data: {
            userId,
            kind: c!.kind,
            body: c!.body,
            refs: c!.refs,
            actions: c!.actions,
            dedupeKey: `taxes:${c!.dedupeKey}`,
          },
        }),
      };
    }

    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("reminds in January, on a tap, and not outside the season", async () => {
      const userId = await person("pin");
      expect((await gather(userId, LINKED)).some((c) => c.dedupeKey.startsWith("ippin:"))).toBe(
        false,
      );
      const { c, message } = await post(userId, "ippin:2027", JAN);
      expect(c.body).toContain("Identity Protection PIN from the IRS");
      expect(parseActions(message.actions).map((a) => a.id)).toEqual([
        "tax.ippin_remind",
        "tax.ippin_have",
        "open",
      ]);
      const after = (
        await takeChatAction(userId, message.id, "tax.ippin_remind", { client, now: JAN })
      ).message;
      expect(after.refs.note).toBe(
        "Done: getting your IP PIN is on your deadlines for 2027-01-31.",
      );
      expect(
        await client.deadline.count({
          where: { userId, title: "Get your IRS Identity Protection PIN" },
        }),
      ).toBe(1);
      await markHavePin(userId, { client, now: JAN });
      expect((await loadIdentity(userId, { client, now: JAN })).havePin).toBe(true);
      expect((await gather(userId, JAN)).some((c) => c.dedupeKey.startsWith("ippin:"))).toBe(false);
    });

    it("puts the reminder on the deadlines by itself at Handle the safe stuff", async () => {
      const userId = await person("pin-auto");
      await setAutopilot(userId, "safe", { client, now: JAN });
      expect((await runTaxAutopilot(userId, { client, now: JAN })).ipPinReminded).toBe(true);
      expect((await runTaxAutopilot(userId, { client, now: JAN })).ipPinReminded).toBe(false);
      const c = (await gather(userId, JAN)).find((x) => x.dedupeKey === "ippin:2027")!;
      expect(c.kind).toBe("done");
      expect(c.body).toContain("I've put it on your deadlines");
    });

    it("a rejected e-file asks, and yes opens the case with the paper return step", async () => {
      const userId = await person("rejected");
      await client.taxReturn.create({
        data: {
          userId,
          year: 2026,
          partner: "demo",
          partnerReturnId: "demo-1",
          status: "rejected",
          package: {},
          preview: {},
        },
      });
      const { c, message } = await post(userId, "identity-sign:rejected:", JAN);
      expect(c.body).toMatch(
        /^Your 2026 return was rejected\. If the e-file is rejected because a return was already filed/,
      );
      await takeChatAction(userId, message.id, "tax.identity_open", { client, now: JAN });
      const view = await loadIdentity(userId, { client, now: JAN });
      expect(view.case!.steps.map((s) => s.key)).toEqual([
        "report_ftc",
        "form_14039",
        "credit_freeze",
        "call_irs",
        "paper_return",
        "ip_pin",
      ]);
      expect(view.candidates).toEqual([]);
    });

    it("tracks the steps to done, one tap each, and the last closes the case", async () => {
      const userId = await person("steps");
      const typed = await sendToJane(userId, "I got a W-2 from a company I never worked for", {
        client,
        now: JAN,
      });
      expect(typed.reply.body).toMatch(
        /^A W-2 or 1099 from a payer you don't know: Income reported under your Social Security number/,
      );
      await takeChatAction(userId, typed.reply.id, "tax.identity_open", { client, now: JAN });

      const order = ["report_ftc", "form_14039", "credit_freeze", "call_irs", "ip_pin"];
      for (const [i, step] of order.entries()) {
        const { c, message } = await post(userId, `identity-step:`, JAN);
        expect(c.dedupeKey.endsWith(`:${step}`), step).toBe(true);
        expect(c.body).toContain(`(${i} of 5 done)`);
        if (step === "call_irs") expect(c.body).toContain("800-908-4490");
        const after = (
          await takeChatAction(userId, message.id, "tax.identity_step", { client, now: JAN })
        ).message;
        expect(after.refs.note).toBe(
          i === order.length - 1
            ? "That's every step. Keep copies of what you sent."
            : "Noted. I'll bring up the next one.",
        );
      }
      const done = await loadIdentity(userId, { client, now: JAN });
      expect(done.case).toBeNull();
      expect(done.havePin).toBe(true);
      expect(
        (await client.taxIdentityCase.findFirstOrThrow({ where: { userId } })).closedAt,
      ).not.toBeNull();
      await expect(markStep(userId, "report_ftc", { client, now: JAN })).rejects.toBeInstanceOf(
        IdentityError,
      );
    });

    it("one case at a time, only the steps the case has", async () => {
      const userId = await person("one");
      await openCase(userId, "irs_letter", "told", { client, now: JAN });
      await expect(openCase(userId, "unknown_form", "told", { client, now: JAN })).rejects.toThrow(
        "already have a case open",
      );
      await expect(markStep(userId, "paper_return", { client, now: JAN })).rejects.toThrow(
        "isn't part of this case",
      );
      await expect(markStep(userId, "nonsense", { client, now: JAN })).rejects.toThrow(
        "don't know that step",
      );
    });

    it("a letter that reads like theft asks, and the Claude tool shows the case", async () => {
      const userId = await person("letter");
      const document = await client.document.create({
        data: {
          userId,
          kind: "tax_notice",
          fileName: "5071c.jpg",
          contentType: "image/jpeg",
          sizeBytes: 3,
          encryptedBytes: Buffer.from("abc"),
        },
      });
      const reading = (await readTaxNotice(userId, document.id, { client, now: JAN }))!;
      await confirmTaxNotice(userId, reading.id, {
        client,
        now: JAN,
        fields: {
          kind: "ID_VERIFY",
          issuer: "irs",
          taxYear: "2026",
          noticeDate: "2027-01-05",
          reason: "We need to verify your identity before processing your return.",
        },
      });
      const { c, message } = await post(userId, "identity-sign:notice:", JAN);
      expect(c.body).toContain("A letter you uploaded reads like an identity problem.");
      await takeChatAction(userId, message.id, "tax.identity_open", { client, now: JAN });
      const tool = JSON.parse(
        (await runChatTool(userId, "tax_identity", {}, { client, now: JAN })).content,
      );
      expect(tool.case).toMatchObject({ sign: "irs_letter", next: "report_ftc" });
      expect(tool.case.steps).toHaveLength(5);
      expect(tool.ipPin).toMatchObject({ have: false, inSeason: true });
    });
  },
);
