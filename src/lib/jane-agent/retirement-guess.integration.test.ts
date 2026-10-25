import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { STAGE_AGES } from "@/config/retirement";
import { saveProfileForm } from "@/lib/investments/profile";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { CHAT_TOOLS, runChatTool } from "./claude-tools";
import { parseIntent } from "./intents";
import { toolsFor } from "./tool-select";

// Found in the chat QA: "when can i stop working" got nothing for the couple near retirement.
// It wasn't read as a retirement question, and the planner needed an answered investor
// profile, which the sample people didn't have then. Now the question reaches the planner, and the planner
// answers from their accounts with an age guessed from their stage of life, said as a guess.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const NO_PLAID = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("no Plaid");
    },
  },
) as never;

describe.runIf(url)("the retirement planner without an investor profile", () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function linked(person?: "preretire") {
    const user = await client.user.create({
      data: { email: `retire-guess-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person });
    await syncItem(itemId, { client, api: NO_PLAID, now: NOW });
    return user.id;
  }

  it("reads 'when can I stop working' as retirement, and sends the planner", () => {
    for (const q of ["when can i stop working", "when could we stop working"]) {
      expect(parseIntent(q, "2026-10-18"), q).toMatchObject({ topic: "retirement" });
      expect(
        toolsFor(CHAT_TOOLS, q, null, null, "2026-10-18").map((t) => t.name),
        q,
      ).toContain("retirement_plan");
    }
  });

  it(
    "answers the couple near retirement from their accounts, saying the age is a guess",
    { timeout: 120_000 },
    async () => {
      const userId = await linked("preretire");
      // The sample people now come with their investor profile (spec step 129); someone who
      // hasn't answered it is this person without it.
      await client.investorProfile.deleteMany({ where: { userId } });
      const out = JSON.parse(
        (await runChatTool(userId, "retirement_plan", {}, { client, now: NOW })).content,
      );
      expect(out.estimate).toContain(`about ${STAGE_AGES.approaching}`);
      expect(out.estimate).toMatch(/ask their age and goals/);
      expect(out.retirementAge).toBe(67);
      expect(out.projectionInTodaysDollars.low).toMatch(/^\$/);
      expect(out.couldPayOutAYear.high).toMatch(/^\$/);
    },
  );

  it(
    "uses the person's own answers, with no guess, once the profile is done",
    { timeout: 120_000 },
    async () => {
      const userId = await linked();
      await saveProfileForm(
        userId,
        { age: "45", horizon: "over_20", dropReaction: "worry", goals: ["retirement"] },
        { client, now: NOW },
      );
      const out = JSON.parse(
        (await runChatTool(userId, "retirement_plan", {}, { client, now: NOW })).content,
      );
      expect(out.estimate).toBeUndefined();
      expect(out.retirementAge).toBe(67);
    },
  );
});
