import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import {
  calendarEvents,
  calendarFeed,
  createCalendarToken,
  turnOffCalendar,
  userForCalendarToken,
} from "./calendar";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("the money calendar against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `cal-${crypto.randomUUID()}@example.com` } })
    ).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Jordan's Secret Checking",
        mask: "9876",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 500_000,
      },
    });
    const row = (date: string, amountCents: number, description: string, pfcPrimary: string) => ({
      userId,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: `${date}-${description}`,
      date: day(date),
      amountCents,
      description,
      pfcPrimary,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        ...["2026-07-20", "2026-08-20", "2026-09-20"].map((d) =>
          row(d, 1549, "NETFLIX.COM", "ENTERTAINMENT"),
        ),
        ...["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((d) =>
          row(d, -250_000, "ACME CORP PAYROLL", "INCOME"),
        ),
      ],
    });
    await client.savingsGoal.create({
      data: { userId, name: "Trip", targetCents: 200_000, targetDate: day("2026-12-01") },
    });
    // Deadlines (spec step 71) come from the same coming-up source as Today: one the person
    // typed in, and a card payment the bank reports, on a card named after them.
    await client.deadline.create({
      data: { userId, title: "Return the jacket", dueOn: day("2026-10-28"), kind: "other" },
    });
    const card = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Jordan's Secret Card",
        mask: "4321",
        type: "credit",
        currentBalanceCents: 80_000,
      },
    });
    await client.liability.create({
      data: {
        userId,
        accountId: card.id,
        kind: "credit",
        minimumPaymentCents: 3_500,
        nextPaymentDueDate: day("2026-10-26"),
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("lists bills, deposits and goals with stable ids", async () => {
    const events = await calendarEvents(userId, { client, now: NOW });
    expect(events.map((e) => [e.date, e.summary])).toEqual(
      expect.arrayContaining([
        ["2026-10-20", "Netflix, about $15.49"],
        ["2026-11-01", "Expected deposit, about $2,500.00"],
        ["2026-12-01", "Goal: Trip ($2,000.00)"],
      ]),
    );
    expect((await calendarEvents(userId, { client, now: NOW })).map((e) => e.uid)).toEqual(
      events.map((e) => e.uid),
    );
  });

  it("lists the deadlines Today shows, a card payment without its card's name", async () => {
    const events = await calendarEvents(userId, { client, now: NOW });
    expect(events.map((e) => [e.date, e.summary])).toEqual(
      expect.arrayContaining([
        ["2026-10-26", "Card or loan payment due, about $35.00"],
        ["2026-10-28", "Return the jacket"],
      ]),
    );
    expect(events.filter((e) => e.uid.startsWith("deadline-"))).toHaveLength(2);
  });

  it("never puts account names or numbers in the feed", async () => {
    const feed = await calendarFeed(userId, { client, now: NOW });
    expect(feed).not.toMatch(/Jordan|Secret Checking|Secret Card|9876|4321/);
  });

  it("opens with the link, and an old link stops working once reset or turned off", async () => {
    const first = await createCalendarToken(userId, { client, now: NOW });
    expect(await userForCalendarToken(first, { client })).toBe(userId);

    const second = await createCalendarToken(userId, { client, now: NOW });
    expect(await userForCalendarToken(first, { client })).toBeNull();
    expect(await userForCalendarToken(second, { client })).toBe(userId);

    await turnOffCalendar(userId, { client });
    expect(await userForCalendarToken(second, { client })).toBeNull();
    expect(await userForCalendarToken("", { client })).toBeNull();

    // Only a hash of the secret is stored.
    const stored = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(JSON.stringify(stored)).not.toContain(second);
  });
});
