import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

const coverage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rls-coverage", () => ({ rlsCoverage: coverage, rlsSwitchWorks: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { reportPlaidSlots, reportRlsGaps } from "./health";

// The daily check's email about row-level security: once per lapse, to each person on the team.

const whole = { role: true, tables: [{ table: "transactions" }], missing: [], ok: true };
const gap = {
  role: true,
  tables: [{ table: "transactions" }, { table: "new_things" }],
  missing: ["new_things"],
  ok: false,
};

function fakeClient() {
  const notices = new Set<string>();
  return {
    notices,
    healthNotice: {
      createMany: vi.fn(async ({ data }: { data: { key: string }[] }) => {
        const fresh = data.filter((d) => !notices.has(d.key));
        fresh.forEach((d) => notices.add(d.key));
        return { count: fresh.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
        notices.delete(where.key);
        return { count: 1 };
      }),
    },
  };
}

describe("reportPlaidSlots", () => {
  const send = vi.fn();
  const clientWith = (used: number) => ({
    ...fakeClient(),
    plaidItemCounter: { findUnique: vi.fn(async () => ({ used })) },
  });
  const report = (client: unknown) =>
    reportPlaidSlots({ client: client as unknown as PrismaClient, send });

  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "ana@example.com, sam@example.com");
    vi.stubEnv("PLAID_ENV", "production");
    vi.stubEnv("PLAID_TRIAL_ITEM_LIMIT", "");
    send.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("says nothing under 8 of 10", async () => {
    expect(await report(clientWith(7))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("emails the team once at 8 of 10, and not again on the next run or the next slot", async () => {
    const client = clientWith(8);
    expect(await report(client)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].subject).toBe("Plaid: 8 of 10 bank connections used");
    expect(await report(client)).toBe(false);
    client.plaidItemCounter.findUnique.mockResolvedValue({ used: 9 });
    expect(await report(client)).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("can warn again after an upgrade moved the mark, and fills up again", async () => {
    const client = clientWith(8);
    await report(client);
    vi.stubEnv("PLAID_TRIAL_ITEM_LIMIT", "100");
    expect(await report(client)).toBe(false);
    expect(client.notices.size).toBe(0);
    client.plaidItemCounter.findUnique.mockResolvedValue({ used: 80 });
    expect(await report(client)).toBe(true);
  });

  it("tries again next time if the email failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientWith(8);
    send.mockRejectedValueOnce(new Error("no"));
    expect(await report(client)).toBe(false);
    expect(await report(client)).toBe(true);
  });

  it("says nothing in Sandbox", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    expect(await report(clientWith(10))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("reportRlsGaps", () => {
  const send = vi.fn();
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "ana@example.com, sam@example.com");
    send.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends nothing while every table is covered", async () => {
    coverage.mockResolvedValue(whole);
    const client = fakeClient();

    expect(await reportRlsGaps({ client: client as unknown as PrismaClient, send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("emails each person on the team once per lapse, naming the tables", async () => {
    const client = fakeClient() as unknown as PrismaClient;
    coverage.mockResolvedValue(gap);

    expect(await reportRlsGaps({ client, send })).toBe(true);
    expect(send.mock.calls.map(([m]) => m.to).sort()).toEqual([
      "ana@example.com",
      "sam@example.com",
    ]);
    expect(send.mock.calls[0][0].subject).toBe("Row-level security has a gap");
    expect(send.mock.calls[0][0].text).toContain(
      "1 of 2 user-owned tables aren't covered: new_things",
    );

    // The next day: still the same lapse, no second email.
    expect(await reportRlsGaps({ client, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);

    // Whole again, then a new gap: a new email.
    coverage.mockResolvedValue(whole);
    await reportRlsGaps({ client, send });
    coverage.mockResolvedValue(gap);
    expect(await reportRlsGaps({ client, send })).toBe(true);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("says when the role itself is missing", async () => {
    coverage.mockResolvedValue({ ...gap, role: false });
    await reportRlsGaps({ client: fakeClient() as unknown as PrismaClient, send });

    expect(send.mock.calls[0][0].text).toContain("the database has no jane_rls role");
  });

  it("tries again next time if the email fails", async () => {
    coverage.mockResolvedValue(gap);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = fakeClient();
    send.mockRejectedValueOnce(new Error("Resend down"));

    expect(await reportRlsGaps({ client: client as unknown as PrismaClient, send })).toBe(false);
    expect(client.notices.size).toBe(0);
    expect(await reportRlsGaps({ client: client as unknown as PrismaClient, send })).toBe(true);
  });
});
