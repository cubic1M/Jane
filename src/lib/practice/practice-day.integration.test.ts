import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { practiceBroker } from "./broker";
import { loadPractice, startPractice } from "./portfolio";

// Gate C's calendar sweep (src/sweep/), 11-15: the practice portfolio priced its holdings at the
// latest close on UTC's day, so at 7pm in Los Angeles it read tomorrow's bar (the sample feed has
// one) and Home's Investing tile split differently from 3pm. It prices at the person's own day.

const url = process.env.TEST_DATABASE_URL;
const BOUGHT = new Date("2026-11-11T18:00:00Z");
// 3pm and 7pm on Thursday Nov 12 in Los Angeles; 7pm is already Friday in UTC, a trading day.
const AFTERNOON = new Date("2026-11-12T23:00:00Z");
const EVENING = new Date("2026-11-13T03:00:00Z");

describe.runIf(url)("the practice portfolio on the person's own day", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `practice-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    await startPractice(userId, 3, { client, now: BOUGHT });
    await practiceBroker().placeOrder(
      userId,
      { ticker: "VTI", side: "buy", amountCents: 400_000, reason: "Test.", rule: "model_buy" },
      { client, now: BOUGHT },
    );
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is worth the same at 7pm as at 3pm", async () => {
    const worth = async (now: Date) => {
      const view = await loadPractice(userId, { client, now });
      return { total: view?.totalCents, holdings: view?.holdings.map((h) => h.valueCents) };
    };
    expect(await worth(EVENING)).toEqual(await worth(AFTERNOON));
  });
});
