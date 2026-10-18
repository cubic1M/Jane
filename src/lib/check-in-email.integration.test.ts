import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { runMonthlyCheckIns } from "./check-in-email";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const OCT_2 = new Date("2026-10-02T18:00:00Z");

describe.runIf(url)("monthly check-in emails against a real database", () => {
  let client: PrismaClient;
  const ids: Record<string, string> = {};
  const send = vi.fn();
  const tag = crypto.randomUUID();

  async function person(name: string, opts: { digest?: boolean; spending?: boolean } = {}) {
    const user = await client.user.create({
      data: {
        email: `${name}-${tag}@example.com`,
        digestEnabled: opts.digest ?? true,
        timezone: "UTC",
      },
    });
    ids[name] = user.id;
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Card", type: "credit" },
    });
    if (opts.spending ?? true) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: "x",
          date: new Date("2026-09-10"),
          amountCents: 4_500,
          description: "GROCER",
          pfcPrimary: "FOOD_AND_DRINK",
        },
      });
    }
  }

  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await person("active");
    await person("quiet", { spending: false });
    await person("optedout", { digest: false });
  });
  beforeEach(() => send.mockReset().mockResolvedValue(undefined));
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const sentTo = () =>
    send.mock.calls.map(([m]) => m.to as string).filter((to) => to.includes(tag));

  it("sends last month's check-in once, early in the month, only to people who get the digest", async () => {
    await runMonthlyCheckIns({ client, now: OCT_2, send });
    expect(sentTo()).toEqual([`active-${tag}@example.com`]);
    const mail = send.mock.calls.find(([m]) => m.to.includes("active-"))?.[0];
    expect(mail.subject).toBe("Your September 2026 check-in");
    expect(mail.text).toContain("In September you spent $45.00");
    expect(mail.headers["List-Unsubscribe"]).toContain("/api/unsubscribe?token=");

    send.mockClear();
    await runMonthlyCheckIns({ client, now: new Date("2026-10-03T18:00:00Z"), send });
    expect(sentTo()).toEqual([]);
  });

  it("waits until next month once the first week has passed", async () => {
    await runMonthlyCheckIns({ client, now: new Date("2026-10-20T18:00:00Z"), send });
    expect(sentTo()).toEqual([]);
  });
});
