import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { SAMPLE_WINS } from "@/data-sources/demo/people-extras/wins";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { savedToDate } from "@/lib/membership/service";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { provenSavings, verifiedSavings } from "@/lib/savings-proof";
import { startTrial } from "@/lib/trial";
import { SAMPLE_WIN_KEY, seedSampleWins } from "./sample-wins";

// Spec step 139 (gap audit): "What Jane saved you" was $0.00 for every sample person. Each now
// comes with past wins Jane finished through the real path, confirmed by their own transactions,
// and every place that shows the total agrees.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-23T15:00:00Z");
const expected = (id: (typeof PEOPLE)[number]["id"]) =>
  SAMPLE_WINS[id].reduce(
    (sum, w) =>
      sum +
      (w.kind === "cancelled"
        ? Math.round(w.monthlyDollars * 100) * 12
        : Math.round(w.dollars * 100)),
    0,
  );

describe.runIf(url)("sample people's past wins", { timeout: 240_000 }, () => {
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
  }, 600_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE)(
    "$id: the wins are confirmed by their transactions, the same total everywhere",
    async (p) => {
      const userId = made.get(p.id)!;
      const proven = await provenSavings(userId, { client, now: NOW });
      // Every win confirmed from the person's own transactions: a refund back, a charge stopped.
      expect(proven.confirmed.map((r) => r.kind).sort()).toEqual(["cancelled", "refund"]);
      expect(proven.confirmedCents).toBe(expected(p.id));
      expect(proven.confirmedCents).toBeGreaterThan(0);
      // Saved-to-date (/jane, home, the weekly email) counts the same.
      expect(await savedToDate(userId, { client })).toBe(proven.confirmedCents);
      // The verified savings record (/saved, the home tile's confirmed figure): all confirmed.
      const verified = await verifiedSavings(userId, { client, now: NOW });
      expect(verified.confirmedCents).toBe(proven.confirmedCents);
      // The chat's tool says the same total.
      const out = JSON.parse(
        (await runChatTool(userId, "proven_savings", {}, { client, now: NOW })).content,
      ) as { confirmedTotal: string; receipts: unknown[] };
      expect(out.confirmedTotal).toBe(
        `$${(proven.confirmedCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      );
      expect(out.receipts).toHaveLength(2);
      // Done through the real path: a yes and a finished action, never an email.
      const actions = await client.action.findMany({
        where: { userId, decision: { finding: { key: { startsWith: SAMPLE_WIN_KEY } } } },
        select: { status: true, completedAt: true, decision: { select: { choice: true } } },
      });
      expect(actions).toHaveLength(2);
      for (const a of actions) {
        expect(a).toMatchObject({ status: "done", decision: { choice: "yes" } });
        expect(a.completedAt!.getTime()).toBeLessThan(NOW.getTime());
      }
    },
  );

  it("seeds once, and never for a real account or the plain demo bank", async () => {
    const userId = made.get("renter")!;
    expect(await seedSampleWins(userId, "renter", { client, now: NOW })).toBe(0);
    const real = await client.user.create({
      data: { email: `wins-${crypto.randomUUID()}@example.com` },
    });
    try {
      const { itemId } = await linkDemoBank(real.id, { client, now: NOW });
      await syncItem(itemId, { client, now: NOW });
      expect(await savedToDate(real.id, { client })).toBe(0);
      expect((await provenSavings(real.id, { client, now: NOW })).confirmedCents).toBe(0);
    } finally {
      await client.user.delete({ where: { id: real.id } });
    }
  });
});
