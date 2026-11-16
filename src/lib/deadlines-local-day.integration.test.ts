import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { addDeadline, listDeadlines } from "./deadlines";

// Gate C's calendar sweep (src/sweep/), 11-15: at 7pm in Los Angeles UTC is already tomorrow, and
// the deadlines read UTC's day. A return window's last day dropped off Home, the cash-flow strip,
// Plans & goals and the chat's "what's coming up" while it was still today for the person, and
// tomorrow's card payment came in early; adding a deadline for today was refused as in the past.
// The same person at 3pm and at 7pm, on the same day of theirs, sees the same list.

const url = process.env.TEST_DATABASE_URL;
// 3pm and 7pm on Nov 15 in Los Angeles; 7pm is already Nov 16 in UTC.
const AFTERNOON = new Date("2026-11-15T23:00:00Z");
const EVENING = new Date("2026-11-16T03:00:00Z");

describe.runIf(url)("deadlines on the person's own day", () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
  });

  async function person() {
    const user = await client.user.create({
      data: {
        email: `deadline-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    made.push(user.id);
    return user.id;
  }

  it("lists a card payment due today at 7pm as at 3pm", async () => {
    const userId = await person();
    const card = await client.account.create({
      data: { userId, source: "csv", name: "Card", type: "credit" },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: card.id,
        kind: "credit",
        nextPaymentDueDate: new Date("2026-11-15T00:00:00Z"),
        minimumPaymentCents: 3_500,
      },
    });
    const list = async (now: Date) =>
      (await listDeadlines(userId, { client, now })).map((d) => [d.title, d.date]);
    const afternoon = await list(AFTERNOON);
    expect(afternoon).toContainEqual(["Card payment", "2026-11-15"]);
    expect(await list(EVENING)).toEqual(afternoon);
  });

  it("takes a deadline for today at 7pm", async () => {
    const userId = await person();
    await addDeadline(
      userId,
      { title: "FSA claims", dueOn: "2026-11-15", kind: "fsa", note: "" },
      { client, now: EVENING },
    );
    expect(await client.deadline.count({ where: { userId } })).toBe(1);
  });
});
