import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { queueNightlyRuns } from "@/lib/controller";
import { remindAllDeadlines } from "@/lib/deadlines";
import { removeAllOrphans } from "@/lib/evidence/orphans";
import { insuranceDaily } from "@/lib/insurance/daily";
import { takeSnapshots } from "@/lib/snapshots";

// A read of what's shared between people: about 500 temporary people, which strangers can make in
// a day or two, cost these loops 68 seconds on a local database. The limit is 300, with the banks
// before them and the controller after, so real people's deadline reminders would be what's lost.
const STAYING = '"userId":{"not":{"startsWith":"trial_"}}';
const STAYING_ID = '"id":{"not":{"startsWith":"trial_"}}';

// A stand-in with nobody in it, keeping what each model was asked for.
function nobody() {
  const asked: { model: string; where: string }[] = [];
  const client = new Proxy(
    {},
    {
      get: (_t, model) =>
        typeof model !== "string" || model.startsWith("$")
          ? undefined
          : {
              findMany: vi.fn(async (args: { where?: unknown }) => {
                asked.push({ model, where: JSON.stringify(args?.where ?? {}) });
                return [];
              }),
              findFirst: vi.fn(async () => null),
              count: vi.fn(async () => 0),
              deleteMany: vi.fn(async () => ({ count: 0 })),
              updateMany: vi.fn(async () => ({ count: 0 })),
            },
    },
  ) as unknown as PrismaClient;
  return { client, asked };
}

describe("a nightly run for everyone", () => {
  it("snapshots only the accounts of people who stay", async () => {
    const { client, asked } = nobody();
    await takeSnapshots({ client });
    expect(asked.find((a) => a.model === "account")?.where).toContain(STAYING);
  });

  it("reminds only people who stay", async () => {
    const { client, asked } = nobody();
    await remindAllDeadlines({ client });
    expect(asked.find((a) => a.model === "user")?.where).toContain(STAYING_ID);
  });

  it("sweeps only people who stay", async () => {
    const { client, asked } = nobody();
    await removeAllOrphans({ client });
    expect(asked.find((a) => a.model === "user")?.where).toContain(STAYING_ID);
  });

  it("queues the controller only for people who stay", async () => {
    const { client, asked } = nobody();
    await queueNightlyRuns({ client, budgetMs: 0 }).catch(() => {});
    expect(asked.find((a) => a.model === "account")?.where).toContain(STAYING);
  });

  it("works through insurance only for people who stay", async () => {
    const { client, asked } = nobody();
    await insuranceDaily({ client });
    const people = asked.filter(
      (a) => a.model === "insurancePolicy" || a.model === "insuranceClaim",
    );
    expect(people.length).toBeGreaterThanOrEqual(7);
    for (const { where } of people) expect(where).toContain(STAYING);
  });

  it("syncs only the banks of people who stay", () => {
    // The route has no way in for a stand-in client, so this reads what it asks for.
    const route = readFileSync("src/app/api/cron/plaid-sync/route.ts", "utf8");
    expect(route).toMatch(/plaidItem\.findMany\(\{\s*where: \{[^}]*userId: STAYING/);
  });

  it("still runs for the people a caller names, whoever they are", async () => {
    const { client, asked } = nobody();
    await takeSnapshots({ client, userIds: ["trial_own_abc"] });
    expect(asked.find((a) => a.model === "account")?.where).toContain("trial_own_abc");
    expect(asked.find((a) => a.model === "account")?.where).not.toContain("startsWith");
  });
});
