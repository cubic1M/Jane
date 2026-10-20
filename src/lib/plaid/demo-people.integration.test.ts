import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { decrypt } from "@/lib/crypto";
import { isTrialUser, startTrial } from "@/lib/trial";
import { syncItem } from "./sync";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)(
  "the eight sample people, through the demo bank's sync",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const made: string[] = [];

    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: made } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it.each(PEOPLE.map((p) => p.id))(
      "%s signs up as a trial person and syncs like a bank",
      async (id) => {
        const trial = await startTrial({ client, now: LINKED, defer: true, person: id });
        made.push(trial.userId);
        // Trial rules (spec step 138) hold: a trial id, a name from the written description.
        expect(isTrialUser(trial.userId)).toBe(true);
        const user = await client.user.findUniqueOrThrow({ where: { id: trial.userId } });
        expect(user.name).toBe(PEOPLE.find((p) => p.id === id)!.name);
        const item = await client.plaidItem.findUniqueOrThrow({ where: { id: trial.itemId } });
        expect(decrypt(item.accessTokenEncrypted)).toMatch(
          new RegExp(`^demo:[a-f0-9]{16}:2026-10-18:${id}$`),
        );
        const result = await syncItem(trial.itemId, { client, now: LINKED });
        expect(result.firstSync).toBe(true);
        expect(result.added).toBeGreaterThan(200);
        expect(
          await client.account.count({ where: { userId: trial.userId } }),
        ).toBeGreaterThanOrEqual(3);
      },
    );
  },
);
