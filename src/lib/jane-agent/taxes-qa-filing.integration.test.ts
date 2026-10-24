import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { PersonId } from "@/config/people";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { sendToJane } from "./typing";

// Taxes QA (2026-10-22): before they said how they file, the Reyes family and Dan and Lena were
// estimated as single (a bill, and a W-4 to withhold more); and late in the year Maya was told to
// put more Step 4(b) deductions on her W-4 than she earns.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)(
  "filing status and the W-4, against a real database",
  { timeout: 180_000 },
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
    async function person(id: PersonId) {
      const user = await client.user.create({
        data: { email: `qa-${id}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
      await syncItem(itemId, { client, api: plaid, now: NOW });
      return user.id;
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

    it("estimates a family with a joint account and two paychecks as married filing jointly, and says so", async () => {
      const userId = await person("family");
      // The guess for a couple who haven't said: the sample family arrives with their answers
      // (src/lib/sample-tax-answers.ts), so they're taken away here.
      await client.taxProfile.deleteMany({ where: { userId } });
      const v = await loadTaxEstimate(userId, { client, now: NOW });
      expect(v.input.filingStatus).toBe("married_joint");
      expect(v.assumptions).toContain(
        "You haven't told me how you file. I see a joint account and two employers' paychecks, so I've estimated as married filing jointly; tell me if that's wrong.",
      );
      expect(v.estimate.refundCents).toBeGreaterThan(0);
    });

    it("keeps one person with one employer single", async () => {
      const userId = await person("renter");
      expect((await loadTaxEstimate(userId, { client, now: NOW })).input.filingStatus).toBe(
        "single",
      );
      const { reply } = await sendToJane(userId, "am I withholding enough", { client, now: NOW });
      // Never more Step 4(b) deductions than the year's pay: the change starts in January.
      expect(reply.body).toMatch(
        /would take more deductions than your pay, so it comes as your refund in the spring\. From January, put \$[\d,.]+ a year in Step 4\(b\)/,
      );
    });
  },
);
