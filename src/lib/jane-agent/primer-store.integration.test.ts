import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { chatPrimer } from "./claude-tools";
import { forgetPrimer } from "./primer-cache";
import { markPrimerStale, readStoredPrimer, usablePrimer } from "./primer-store";

// The person's numbers for Claude are saved after the scan and read back in one query, so the
// chat doesn't look every sector up while someone waits.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the numbers for Claude, saved", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const trial = await startTrial({ client, now: NOW, defer: true, person: "family" });
    userId = trial.userId;
    await syncItem(trial.itemId, { client, now: NOW, progressive: true });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is saved when the first scan finishes", async () => {
    const stored = await readStoredPrimer(userId, { client });
    expect(stored).not.toBeNull();
    expect(stored!.primer.text.length).toBeGreaterThan(50);
    // With what matters most and the open findings, so the usual questions need no lookup.
    expect(stored!.primer.text).toMatch(/^what_matters_most: \[/m);
    expect(stored!.primer.text).toMatch(/^open_findings_summary: /m);
    expect(stored!.at.getTime()).toBe(NOW.getTime());
  });

  it("is read back in one query while the data is the same", async () => {
    forgetPrimer();
    const saved = (await readStoredPrimer(userId, { client }))!.primer;
    const read = await chatPrimer(userId, { client, now: new Date(NOW.getTime() + 60_000) });
    expect(read.text).toBe(saved.text);
    expect(read.cents).toEqual(saved.cents);
  });

  it("is old after a tap or a correction, still answers at once, and is refreshed behind it", async () => {
    forgetPrimer();
    const before = (await readStoredPrimer(userId, { client }))!.primer;
    await markPrimerStale(userId, { client });
    expect((await readStoredPrimer(userId, { client }))!.at.getTime()).toBe(0);
    const later = new Date(NOW.getTime() + 120_000);
    const answered = await chatPrimer(userId, { client, now: later });
    expect(answered.text).toBe(before.text);
    // The refresh runs behind it and saves the new numbers (the data has changed).
    await vi.waitFor(
      async () => {
        const stored = (await readStoredPrimer(userId, { client }))!;
        expect(stored.at.getTime()).toBe(later.getTime());
      },
      { timeout: 60_000, interval: 250 },
    );
  });

  it("isn't said once the data has changed, or on another day (card-chat mismatch)", async () => {
    forgetPrimer();
    const later = new Date(NOW.getTime() + 180_000);
    const saved = (await readStoredPrimer(userId, { client }))!.primer;
    // A copy from yesterday is worked out again.
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(usablePrimer((await readStoredPrimer(userId, { client }))!, null, tomorrow)).toBe(false);
    // A bank disconnected or a file removed: the saved numbers had its money in them.
    await client.transaction.deleteMany({ where: { userId } });
    const read = await chatPrimer(userId, { client, now: later });
    expect(read.text).not.toBe(saved.text);
    expect((await readStoredPrimer(userId, { client }))!.at.getTime()).toBe(later.getTime());
  });
});
