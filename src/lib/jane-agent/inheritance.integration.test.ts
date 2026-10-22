import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadInheritance } from "@/lib/inheritance";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { correctFact } from "@/lib/profile";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 268 against a real, migrated Postgres: an inherited IRA found by its name, the date
// it must be empty by once the person says when the owner died, gifts over the annual
// exclusion, and facts only (no legal advice) with a pointer to a tax professional.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "inherited money and gifts against a real database",
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

    async function person(prefix: string, withIra: boolean) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      if (withIra) {
        await client.account.create({
          data: {
            userId: user.id,
            source: "plaid",
            itemId,
            name: "Inherited IRA",
            type: "investment",
            subtype: "ira",
            currentBalanceCents: 20_000_000,
          },
        });
      }
      const checking = await client.account.findFirstOrThrow({
        where: { userId: user.id, subtype: "checking" },
      });
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date("2026-08-10T00:00:00Z"),
          amountCents: 4_000_000,
          description: "WIRE TRANSFER TO EMILY",
          pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        },
      });
      return user.id;
    }
    const candidates = async (userId: string) =>
      taxesSource.gather((await loadSnapshot(userId, { client, now: LINKED }))!, context);

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

    it("finds the inherited IRA, brings up how to spread it, and gives the date once the year is told", async () => {
      const userId = await person("inh", true);
      const v = await loadInheritance(userId, { client, now: LINKED });
      expect(v.inherited).toHaveLength(1);
      expect(v.inherited[0]).toMatchObject({
        name: "Inherited IRA",
        balanceCents: 20_000_000,
        emptyBy: null,
        yearsLeft: 10,
      });

      const first = (await candidates(userId)).find((c) => c.dedupeKey.startsWith("inherited:"))!;
      expect(first.body).toMatch(
        /^You have \$200,000 in Inherited IRA\. Most heirs have to empty it within 10 years of the owner's death; tell me the year and I'll give the date\./,
      );
      expect(first.body).toContain("A tax professional should confirm which applies to you");
      expect(first.refs.advice).toBe(true);

      await correctFact(userId, "inherited_ira_death_year", "2022", { client, now: LINKED });
      const told = (await candidates(userId)).find((c) => c.dedupeKey.startsWith("inherited:"))!;
      expect(told.body).toContain("empty by December 31, 2032");
      const tool = JSON.parse(
        (await runChatTool(userId, "tax_inherited", {}, { client, now: LINKED })).content,
      );
      expect(tool.inheritedIras[0]).toMatchObject({
        mustBeEmptyByEndOf: 2032,
        diedYearKnown: true,
        fromSpouse: null,
      });
      expect(tool.stepUpInBasis).toContain("value on the day the owner died");

      const { reply } = await sendToJane(userId, "I inherited an IRA, what do I do", {
        client,
        now: LINKED,
      });
      expect(reply.body).toMatch(/^Here is what I can say about inherited money and gifts\./);
      expect(reply.body).toContain("empty by December 31, 2032");
      expect(reply.body).toContain("An estate lawyer can say what applies");
    });

    it("treats an IRA from a spouse as theirs, with no deadline and no suggestion", async () => {
      const userId = await person("inh-spouse", true);
      await correctFact(userId, "inherited_from_spouse", "yes", { client, now: LINKED });
      const v = await loadInheritance(userId, { client, now: LINKED });
      expect(v.inherited[0]).toMatchObject({ fromSpouse: true, emptyBy: null, spread: null });
      expect((await candidates(userId)).some((c) => c.dedupeKey.startsWith("inherited:"))).toBe(
        false,
      );
      const { reply } = await sendToJane(userId, "I inherited my husband's IRA", {
        client,
        now: LINKED,
      });
      expect(reply.body).toContain("came from your spouse: you can treat it as your own");
    });

    it("flags a gift over the annual exclusion as a heads-up, with no dollars of tax promised", async () => {
      const userId = await person("inh-gift", false);
      const v = await loadInheritance(userId, { client, now: LINKED });
      expect(v.gifts).toEqual([
        { recipient: "EMILY", cents: 4_000_000, overCents: 2_100_000, splitCovers: false },
      ]);
      const gift = (await candidates(userId)).find((c) => c.dedupeKey.startsWith("gifts:"))!;
      expect(gift.kind).toBe("heads_up");
      expect(gift.body).toMatch(
        /You sent EMILY \$40,000\.00 this year, \$21,000\.00 over the \$19,000\.00 a person can give another/,
      );
      expect(gift.body).toContain("No tax is usually owed");
      expect(gift.body).toContain("A tax professional can prepare the form");
    });
  },
);
