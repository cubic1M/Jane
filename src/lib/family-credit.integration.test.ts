import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadProfileInput } from "@/lib/profile";
import {
  FamilyCreditError,
  addFamilyCredit,
  loadFamilyCredit,
  removeFamilyCredit,
  setMissed,
} from "./family-credit";

// Spec step 249 against a real, migrated Postgres, on the demo banks of Chris (debts, so a
// debt load to count against) and the Reyes (a card to add a child to): a co-signed loan is
// counted in full in the person's own debt-to-income, and a missed payment lands on them.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)(
  "helping family with credit against a real database",
  { timeout: 30_000 },
  () => {
    let client: PrismaClient;
    let chris: string;
    let reyes: string;
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
    const later = () => new Date(NOW.getTime() + ++tick * MINUTE);
    const opts = (now = NOW) => ({ client, now });

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const make = async (person: "debt" | "family") => {
        const user = await client.user.create({
          data: { email: `famcredit-${person}-${crypto.randomUUID()}@example.com` },
        });
        created.push(user.id);
        const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person });
        await syncItem(itemId, { client, api: plaid, now: NOW });
        return user.id;
      };
      chris = await make("debt");
      reyes = await make("family");
    }, 180_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("counts a co-signed loan in full in Chris's own debt load, and says what a miss does", async () => {
      const before = await loadFamilyCredit(chris, opts());
      expect(before.cosign.exposureCents).toBe(0);
      expect(before.cosign.shareBefore).not.toBeNull();

      await addFamilyCredit(
        chris,
        { kind: "cosigned", person: "Jess", balanceCents: 1_200_000, monthlyPaymentCents: 30_000 },
        opts(),
      );
      const d = await loadFamilyCredit(chris, opts());
      expect(d.cosign.exposureCents).toBe(1_200_000);
      expect(d.cosign.shareWith!).toBeGreaterThan(d.cosign.shareBefore!);
      expect(d.cosign.shareWith! - d.cosign.shareBefore!).toBeCloseTo(
        30_000 / (before.cosign.shareBefore! ? await incomeOf(chris) : 1),
        3,
      );
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: chris },
        "family_credit_changed",
        { type: "family_credit", id: expect.any(String) },
        { kind: "cosigned", change: "added" },
      );

      const input = await loadProfileInput(chris, opts());
      expect(input.familyCredit).toEqual({
        helped: 0,
        cosignedOwedCents: 1_200_000,
        cosignedMissed: 0,
      });

      await setMissed(chris, d.entries[0].id, true, opts());
      expect((await loadFamilyCredit(chris, opts())).missed).toHaveLength(1);
      expect((await loadProfileInput(chris, opts())).familyCredit?.cosignedMissed).toBe(1);
    });

    it("answers in the chat, with the co-signed loan and the missed payment, advice only in the demo", async () => {
      const { reply } = await sendToJane(chris, "should I cosign a loan for my brother", {
        client,
        now: later(),
      });
      expect(reply.body).toContain("Co-signing:");
      expect(reply.body).toContain("You've co-signed $12,000.00 in all, $300.00 a month.");
      expect(reply.body).toMatch(
        /Counted in full, your debt payments go from \d+% to \d+% of your income\./,
      );
      expect(reply.body).toContain("Jess missed a payment");
      expect(reply.body).toContain("The two safer ones:");
      const tool = JSON.parse((await runChatTool(chris, "family_credit", {}, opts())).content);
      expect(tool.cosigned.loans).toEqual([
        { for: "Jess", owed: "$12,000.00", monthlyPayment: "$300.00", missedPayment: true },
      ]);
      expect(tool.cosigned.yourDebtPaymentsShareOfIncome.withCosignedCountedInFull).toBeGreaterThan(
        tool.cosigned.yourDebtPaymentsShareOfIncome.before,
      );
    });

    it("finds the Reyes a card to add a child to, and refuses what makes no sense", async () => {
      const d = await loadFamilyCredit(reyes, opts());
      expect(d.advice).toBe(true);
      // The card is 39% used against the report's limit: too high to add a child to.
      expect(d.cards[0].au.utilisation).toBe(0.39);
      expect(d.bestCard).toBeNull();
      const { reply } = await sendToJane(
        reyes,
        "add my daughter to my card as an authorized user",
        {
          client,
          now: later(),
        },
      );
      expect(reply.body).toContain("none of your cards is used under 30% of its limit");
      expect(d.fileStartCents).toBeGreaterThan(50_000);
      await expect(
        addFamilyCredit(reyes, { kind: "nonsense", person: "A" }, opts()),
      ).rejects.toBeInstanceOf(FamilyCreditError);
      await expect(
        addFamilyCredit(reyes, { kind: "first_card", person: "  " }, opts()),
      ).rejects.toThrow(/Who/);
      await expect(
        addFamilyCredit(reyes, { kind: "cosigned", person: "A" }, opts()),
      ).rejects.toThrow(/what's owed or the monthly payment/);
      await expect(
        addFamilyCredit(reyes, { kind: "cosigned", person: "A", balanceCents: -5 }, opts()),
      ).rejects.toThrow(/dollar amount/);
      const id = await addFamilyCredit(reyes, { kind: "authorized_user", person: "Mia" }, opts());
      expect((await loadProfileInput(reyes, opts())).familyCredit?.helped).toBe(1);
      await removeFamilyCredit(reyes, id, opts());
      expect((await loadFamilyCredit(reyes, opts())).entries).toEqual([]);
    });

    it("keeps one person's entries from another", async () => {
      const mine = (await loadFamilyCredit(chris, opts())).entries[0];
      await expect(removeFamilyCredit(reyes, mine.id, opts())).rejects.toBeInstanceOf(
        FamilyCreditError,
      );
      await expect(setMissed(reyes, mine.id, false, opts())).rejects.toBeInstanceOf(
        FamilyCreditError,
      );
      expect((await loadFamilyCredit(chris, opts())).entries).toHaveLength(1);
    });

    async function incomeOf(userId: string): Promise<number> {
      const { loadDebtTrouble } = await import("@/lib/debt-trouble");
      return (await loadDebtTrouble(userId, opts())).incomeCents!;
    }
  },
);
