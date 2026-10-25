import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { questionsSource } from "@/lib/jane-agent/sources/questions";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { loadProfile } from "./profile";
import { answerQuestion, nextQuestion, planQuestion, QuestionError } from "./questions";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)(
  "the one question worth asking, through the database",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const made = new Map<string, string>();

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      for (const p of PEOPLE) {
        const trial = await startTrial({ client, now: NOW, defer: true, person: p.id });
        await syncItem(trial.itemId, { client, now: NOW });
        made.set(p.id, trial.userId);
      }
    }, 120_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it.each(PEOPLE)(
      "$id is asked their highest-value question first, as a message with buttons",
      async (person) => {
        const userId = made.get(person.id)!;
        await planQuestion(userId, { client, now: NOW });
        const q = await nextQuestion(userId, { client, now: NOW });
        expect(q?.fact).toBe(person.firstQuestion ?? undefined);
        const snapshot = await loadSnapshot(userId, { client, now: NOW });
        const [message] = questionsSource.gather(snapshot!, { now: NOW } as never);
        // The retiree's investor profile answers what was left (spec step 129): nothing to ask.
        if (person.firstQuestion === null) {
          expect(message).toBeUndefined();
          return;
        }
        expect(message.refs.askFact).toBe(person.firstQuestion);
        expect(message.actions.at(-1)?.label).toBe("Skip");
        expect(message.actions.length).toBeLessThanOrEqual(5);
      },
    );

    it("puts an answer in the profile, and never asks the same thing twice", async () => {
      const userId = made.get("renter")!;
      const asked: string[] = [];
      for (let round = 0; round < 6; round += 1) {
        await planQuestion(userId, { client, now: NOW });
        const q = await nextQuestion(userId, { client, now: NOW });
        if (!q) break;
        expect(asked).not.toContain(q.fact);
        asked.push(q.fact);
        // First answer, except every other question is skipped.
        await answerQuestion(userId, q.fact, round % 2 === 0 ? 1 : 5, { client, now: NOW });
      }
      expect(asked[0]).toBe("employer_match");
      const { facts } = await loadProfile(userId, { client, now: NOW });
      expect(facts.employer_match).toMatchObject({ value: "yes", source: "told", confidence: 100 });
      await planQuestion(userId, { client, now: NOW });
      expect(await nextQuestion(userId, { client, now: NOW })).toBeNull();
      // A skipped question stays unknown and is not asked again.
      await expect(
        answerQuestion(userId, "nonsense", 1, { client, now: NOW }),
      ).rejects.toBeInstanceOf(QuestionError);
    });

    it("asks one at a time: while one is waiting in the chat, no other is offered", async () => {
      const userId = made.get("owner")!;
      await planQuestion(userId, { client, now: NOW });
      await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: "Q",
          dedupeKey: "questions:business_structure",
          status: "open",
        },
      });
      expect(await nextQuestion(userId, { client, now: NOW })).toBeNull();
      await client.janeMessage.updateMany({
        where: { userId, dedupeKey: "questions:business_structure" },
        data: { status: "dismissed" },
      });
      // Put to them once already, so it's not asked again; the next best is.
      await planQuestion(userId, { client, now: NOW });
      const next = await nextQuestion(userId, { client, now: NOW });
      expect(next?.fact).not.toBe("business_structure");
    });
  },
);
