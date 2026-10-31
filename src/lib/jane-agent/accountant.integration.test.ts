import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { MAX_ACTIVE_LINKS, MAX_NOTES_PER_LINK } from "@/config/accountant";
import {
  AccountantError,
  answerByToken,
  createAccountantLink,
  loadAccountantPage,
  markNotesSeen,
  revokeAccountantLink,
  viewByToken,
} from "@/lib/accountant";
import { logAudit } from "@/lib/audit";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };
const tokenOf = (u: string) => u.split("/accountant/")[1];

describe.runIf(url)(
  "working with an accountant against a real database",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("no plaid");
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
      return { userId: user.id, email: user.email };
    }
    const messageFrom = async (userId: string, key: string) => {
      const c = taxesSource
        .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
        .find((x) => x.dedupeKey.startsWith(key));
      if (!c) return null;
      return client.janeMessage.create({
        data: {
          userId,
          kind: c.kind,
          body: c.body,
          refs: c.refs,
          actions: c.actions,
          dedupeKey: `taxes:${c.dedupeKey}:${crypto.randomUUID()}`,
        },
      });
    };
    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });
    beforeEach(() => vi.mocked(logAudit).mockClear());
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("makes a link that shows only tax information, and logs every view", async () => {
      const { userId, email } = await person("acct");
      await client.transaction.create({
        data: {
          userId,
          accountId: (
            await client.account.findFirstOrThrow({ where: { userId, subtype: "checking" } })
          ).id,
          source: "plaid",
          date: new Date("2026-09-12T00:00:00Z"),
          amountCents: 4_321,
          description: "SECRET GROCER 12345",
          merchantName: "SECRET GROCER 12345",
          pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
        },
      });
      const { url: link, expiresOn } = await createAccountantLink(
        userId,
        { label: "Dana at Hill & Co", days: 14 },
        { client, now: LINKED },
      );
      expect(link).toMatch(/\/accountant\/[A-Za-z0-9_-]{43}$/);
      expect(expiresOn).toBe("2026-11-01");
      const token = tokenOf(link);
      // Only the hash of the token is stored.
      const row = await client.accountantLink.findFirstOrThrow({ where: { userId } });
      expect(row.tokenHash).not.toContain(token);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: userId },
        "accountant_link_created",
        { type: "accountant_link", id: row.id },
        { days: 14 },
      );

      const result = await viewByToken(token, { client, now: LINKED });
      expect(result.state).toBe("ok");
      if (result.state !== "ok") return;
      const view = result.view;
      expect(view.label).toBe("Dana at Hill & Co");
      expect(view.summary.totalTaxCents).toBeGreaterThan(0);
      expect(view.pack.forms.length).toBeGreaterThan(0);
      expect(view.deductions.length).toBeGreaterThan(0);
      // Nothing but tax data: the keys are exactly these, and nothing identifies the person or
      // their accounts.
      expect(Object.keys(view).sort()).toEqual(
        [
          "collected",
          "complexity",
          "deductions",
          "expiresOn",
          "label",
          "notes",
          "pack",
          "questions",
          "summary",
          "year",
        ].sort(),
      );
      const accounts = await client.account.findMany({ where: { userId } });
      const text = JSON.stringify(view);
      expect(text).not.toContain(email);
      expect(text).not.toContain(userId);
      for (const a of accounts) expect(text, a.name).not.toContain(a.id);
      // Spending that isn't tax-tagged stays out.
      expect(text).not.toContain("SECRET GROCER 12345");
      expect(text).not.toMatch(/currentBalance|availableBalance|accessToken/i);

      // Every view is logged, and counted.
      expect(logAudit).toHaveBeenCalledWith(
        { type: "system", id: null },
        "accountant_link_viewed",
        { type: "accountant_link", id: row.id },
        { user_id: userId },
      );
      await viewByToken(token, { client, now: LINKED });
      const after = await client.accountantLink.findFirstOrThrow({ where: { userId } });
      expect(after.viewCount).toBe(2);
      expect(
        vi.mocked(logAudit).mock.calls.filter((c) => c[1] === "accountant_link_viewed"),
      ).toHaveLength(2);
      const page = await loadAccountantPage(userId, { client, now: LINKED });
      expect(page.links[0]).toMatchObject({
        state: "active",
        viewCount: 2,
        lastViewedOn: "2026-10-18",
      });
    });

    it("stops at its expiry, and when revoked, without saying which", async () => {
      const { userId } = await person("acct-end");
      const a = tokenOf(
        (await createAccountantLink(userId, { label: "A", days: 7 }, { client, now: LINKED })).url,
      );
      const b = tokenOf(
        (await createAccountantLink(userId, { label: "B", days: 30 }, { client, now: LINKED })).url,
      );
      const day = 86_400_000;
      // A works the day before it ends and not at the moment it does.
      expect(
        (await viewByToken(a, { client, now: new Date(LINKED.getTime() + 7 * day - 1) })).state,
      ).toBe("ok");
      expect(await viewByToken(a, { client, now: new Date(LINKED.getTime() + 7 * day) })).toEqual({
        state: "unavailable",
      });
      expect(
        (await viewByToken(b, { client, now: new Date(LINKED.getTime() + 7 * day) })).state,
      ).toBe("ok");

      const rowB = await client.accountantLink.findFirstOrThrow({ where: { userId, label: "B" } });
      await revokeAccountantLink(userId, rowB.id, { client, now: LINKED });
      expect(await viewByToken(b, { client, now: LINKED })).toEqual({ state: "unavailable" });
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: userId },
        "accountant_link_revoked",
        { type: "accountant_link", id: rowB.id },
      );
      await expect(revokeAccountantLink(userId, rowB.id, { client, now: LINKED })).rejects.toThrow(
        "isn't live",
      );
      // A revoked or expired link can't be answered on either.
      await expect(
        answerByToken(
          b,
          { questionKey: null, name: "Dana", body: "hello" },
          { client, now: LINKED },
        ),
      ).rejects.toThrow("isn't available");
      // A made-up token is the same as an ended one.
      expect(await viewByToken("x".repeat(43), { client, now: LINKED })).toEqual({
        state: "unavailable",
      });
      expect(await viewByToken("short", { client, now: LINKED })).toEqual({ state: "unavailable" });
      // Someone else's person can't revoke it.
      const other = await person("acct-other");
      await expect(
        revokeAccountantLink(other.userId, rowB.id, { client, now: LINKED }),
      ).rejects.toBeInstanceOf(AccountantError);
    });

    it("checks what's asked, and caps live links and notes", async () => {
      const { userId } = await person("acct-limits");
      await expect(
        createAccountantLink(userId, { label: " ", days: 14 }, { client, now: LINKED }),
      ).rejects.toThrow("Say who it's for");
      await expect(
        createAccountantLink(userId, { label: "A", days: 400 }, { client, now: LINKED }),
      ).rejects.toThrow("Pick 7, 14, 30 days");
      let token = "";
      for (let i = 0; i < MAX_ACTIVE_LINKS; i++) {
        token = tokenOf(
          (await createAccountantLink(userId, { label: `L${i}`, days: 7 }, { client, now: LINKED }))
            .url,
        );
      }
      await expect(
        createAccountantLink(userId, { label: "one more", days: 7 }, { client, now: LINKED }),
      ).rejects.toThrow("enough live links");

      await expect(
        answerByToken(token, { questionKey: null, name: "", body: "hi" }, { client, now: LINKED }),
      ).rejects.toThrow("Add your name");
      await expect(
        answerByToken(
          token,
          { questionKey: null, name: "Dana", body: " " },
          { client, now: LINKED },
        ),
      ).rejects.toThrow("Write an answer");
      await expect(
        answerByToken(
          token,
          { questionKey: null, name: "Dana", body: "x".repeat(2_001) },
          { client, now: LINKED },
        ),
      ).rejects.toThrow("under 2000");
      await expect(
        answerByToken(
          token,
          { questionKey: "need:nothing", name: "Dana", body: "hi" },
          { client, now: LINKED },
        ),
      ).rejects.toThrow("isn't open any more");
      const link = await client.accountantLink.findFirstOrThrow({ where: { userId, label: "L2" } });
      await client.accountantNote.createMany({
        data: Array.from({ length: MAX_NOTES_PER_LINK }, () => ({
          userId,
          linkId: link.id,
          fromName: "D",
          body: "x",
        })),
      });
      await expect(
        answerByToken(
          token,
          { questionKey: null, name: "Dana", body: "one more" },
          { client, now: LINKED },
        ),
      ).rejects.toThrow("all the answers it can take");
    });

    it("brings the accountant's answers back, with a button, and into the chat and Claude", async () => {
      const { userId } = await person("acct-back");
      const token = tokenOf(
        (await createAccountantLink(userId, { label: "Dana", days: 14 }, { client, now: LINKED }))
          .url,
      );
      const open = await viewByToken(token, { client, now: LINKED });
      if (open.state !== "ok") throw new Error("expected ok");
      // Jane's questions are on it; answer the first, and leave a note of their own.
      const q = open.view.questions[0];
      expect(q).toBeDefined();
      await answerByToken(
        token,
        { questionKey: q.key, name: "Dana Hill", body: "Yes, that is enough." },
        { client, now: LINKED },
      );
      await answerByToken(
        token,
        { questionKey: null, name: "Dana Hill", body: "Please send the 1098." },
        { client, now: LINKED },
      );
      expect(logAudit).toHaveBeenCalledWith(
        { type: "system", id: null },
        "accountant_link_answered",
        expect.objectContaining({ type: "accountant_link" }),
        expect.objectContaining({ user_id: userId }),
      );
      const again = await viewByToken(token, { client, now: LINKED });
      if (again.state !== "ok") throw new Error("expected ok");
      expect(again.view.questions[0].answers).toEqual([
        { fromName: "Dana Hill", body: "Yes, that is enough.", on: "2026-10-18" },
      ]);
      expect(again.view.notes).toEqual([
        { fromName: "Dana Hill", body: "Please send the 1098.", on: "2026-10-18" },
      ]);

      // Back in Jane: a message with a Got it button, and the owner's page.
      const message = (await messageFrom(userId, "accountant_answer:"))!;
      expect(message.body).toMatch(/^Your accountant wrote back \(2 notes\)\. Dana Hill said: "/);
      expect((await loadAccountantPage(userId, { client, now: LINKED })).unseen).toBe(2);
      const done = (
        await takeChatAction(userId, message.id, "tax.accountant_seen", { client, now: LINKED })
      ).message;
      expect(done.refs.note).toBe("Okay, I'll keep their answers on your accountant page.");
      expect((await loadAccountantPage(userId, { client, now: LINKED })).unseen).toBe(0);
      expect(await markNotesSeen(userId, { client, now: LINKED })).toBe(0);

      const tool = JSON.parse(
        (await runChatTool(userId, "tax_accountant", {}, { client, now: LINKED })).content,
      );
      expect(tool.theirAnswers).toHaveLength(2);
      expect(tool.links[0]).toMatchObject({ for: "Dana", state: "active", timesOpened: 2 });
      const { reply } = await sendToJane(userId, "how do I share my taxes with my accountant", {
        client,
        now: LINKED,
      });
      expect(reply.body).toMatch(/^Here is where working with an accountant stands\./);
      expect(reply.body).toContain("You have 1 live link for an accountant.");
    });

    it("says plainly when a return is the kind people bring an accountant to, once, while there's no live link", async () => {
      const { userId } = await person("acct-complex");
      await client.equityEvent.create({
        data: {
          userId,
          kind: "rsu",
          company: "Acme",
          shares: 10,
          occurredOn: new Date("2026-03-01"),
          priceCents: 0,
          fmvCents: 10_000,
          withheldCents: 0,
        },
      });
      await client.transaction.create({
        data: {
          userId,
          accountId: (
            await client.account.findFirstOrThrow({ where: { userId, subtype: "checking" } })
          ).id,
          source: "plaid",
          date: new Date("2026-06-10T00:00:00Z"),
          amountCents: -400_000,
          description: "UPWORK PAYMENT",
          pfcDetailed: "INCOME_OTHER_INCOME",
        },
      });
      const page = await loadAccountantPage(userId, { client, now: LINKED });
      expect(page.complexity.factors).toContain("equity");
      if (!page.complexity.complex) {
        // The demo bank alone may only show one factor; add a rental.
        await client.taxProfile.upsert({
          where: { userId },
          create: { userId, homeSoldOn: new Date("2026-05-01") },
          update: { homeSoldOn: new Date("2026-05-01") },
        });
      }
      const after = await loadAccountantPage(userId, { client, now: LINKED });
      expect(after.complexity.complex).toBe(true);
      const message = (await messageFrom(userId, "accountant:"))!;
      expect(message.body).toMatch(
        /^Your taxes include .*People with that mix usually work with an accountant or tax preparer\./,
      );
      await createAccountantLink(userId, { label: "Dana", days: 14 }, { client, now: LINKED });
      expect(await messageFrom(userId, "accountant:")).toBeNull();
    });
  },
);
