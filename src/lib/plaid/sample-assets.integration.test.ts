import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { netWorth } from "@/insights/net-worth";
import { startTrial } from "@/lib/trial";
import { syncItem } from "./sync";

// QA: every sample person owned the same $404,500 home and car, so Chris (renting, in debt)
// had a net worth of $381,648. They now own what their written life says.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("what the sample people own", { timeout: 120_000 }, () => {
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

  it.each(PEOPLE)("$id owns a home exactly when they own one", async (person) => {
    const trial = await startTrial({ client, now: NOW, defer: true, person: person.id });
    made.push(trial.userId);
    await syncItem(trial.itemId, { client, now: NOW });
    const assets = await client.ownedAsset.findMany({ where: { userId: trial.userId } });
    expect(assets.some((a) => a.kind === "home")).toBe(person.facts.owns === "home");
    // Their mortgage, if they have one, is against their home.
    const accounts = await client.account.findMany({
      where: { userId: trial.userId },
      select: { id: true, type: true, subtype: true, currentBalanceCents: true },
    });
    if (accounts.some((a) => a.subtype === "mortgage")) {
      expect(assets.find((a) => a.kind === "home")?.loanAccountId).not.toBeNull();
    }
    if (person.id === "debt") {
      // Renting, with cards near their limits: not rich.
      const worth = netWorth(
        accounts.map((a) => ({ ...a, name: "", balanceCents: a.currentBalanceCents })),
      );
      const owned = assets.reduce((s, a) => s + a.valueCents, 0);
      expect(owned).toBeLessThan(2_000_000);
      expect(worth.netCents + owned).toBeLessThan(0);
    }
  });
});
