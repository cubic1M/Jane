import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The day concierge is on for real accounts: what nothing carries out still mustn't be promised.
vi.mock("@/config/concierge", () => ({ CONCIERGE_ACTIONS: { realAccounts: true, demo: true } }));

import { CarLoanError, requestCancellation } from "./car-loan";
import { answerInvestments } from "./jane-agent/investments/answer";
import { RentingError, setRentReporting } from "./renting";

// Rent reporting's partner is a stand-in, nothing takes the team's add-on cancellations, and what
// Jane would change in someone's investments is advice: none of it is for a real account, even with
// concierge on. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("what a real account is told Jane does", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `promises-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("isn't that its rent is being reported", async () => {
    await expect(setRentReporting(userId, true, { client })).rejects.toBeInstanceOf(RentingError);
    expect(await client.rentReporting.count({ where: { userId } })).toBe(0);
    // Turning it off is always allowed.
    await setRentReporting(userId, false, { client });
  });

  it("isn't that the team will send an add-on's cancellation", async () => {
    const addon = await client.carAddon.create({
      data: {
        userId,
        key: `typed:${crypto.randomUUID()}`,
        kind: "gap",
        name: "GAP cover",
        paidCents: 79_500,
        termMonths: 60,
        startedOn: new Date("2026-01-15"),
        status: "confirmed",
        source: "typed",
      },
    });
    await expect(requestCancellation(userId, addon.id, "team", { client })).rejects.toBeInstanceOf(
      CarLoanError,
    );
    await requestCancellation(userId, addon.id, "mine", { client });
  });

  it("isn't what Jane would change in its investments, or that it trades", async () => {
    const reply = await answerInvestments(
      userId,
      { kind: "investments", topic: "autopilot" } as never,
      { client, now: new Date("2026-11-05T12:00:00Z") },
    );
    expect(reply.body).not.toMatch(/what I'd change|orders ready|invest every payday/);
    expect(reply.body).toMatch(/doesn't trade or move money/);
  });
});
