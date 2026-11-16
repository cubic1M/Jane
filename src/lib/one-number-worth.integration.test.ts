import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { runDetection } from "@/detection/engine";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { bandCeiling } from "@/lib/report-state";
import { scanSuggestions } from "@/lib/suggestions";

// Gate B, "one number, one source" (docs/one-number.md): a thing the report found and the dock
// suggests is worth one figure, and is one % sure. The dock's detectors priced price rises (×12
// against the report's charges a year), overlapping subscriptions (a yearly plan ×12), bills
// (a share of the whole bill against the part above its typical price) and trials (a year of
// charges against the one to ask back) their own way, and showed their own % where the report
// kept it inside the finding's level. Now they say the report's (src/detectors/helpers.ts
// reportsWorth, src/lib/report-state.ts bandCeiling).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T17:00:00Z");
// The topics the report and the dock both cover, by the same name.
const SHARED = [
  "bank_fees",
  "bill_negotiation",
  "card_interest",
  "duplicate_charge",
  "duplicate_subscription",
  "price_increase",
  "trial_conversion",
] as const;

describe.runIf(url)("a finding's worth, one number", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE.map((p) => p.id))("%s: the dock says the report's figure and %", async (id) => {
    const user = await client.user.create({
      data: { email: `one-number-worth-${id}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id as PersonId });
    await syncItem(itemId, { client, now: NOW });
    await runDetection(user.id, { client, now: NOW });
    await scanSuggestions(user.id, { client, now: NOW });
    const [findings, suggestions] = await Promise.all([
      client.finding.findMany({
        where: { userId: user.id, status: { in: ["new", "shown"] } },
        select: { type: true, annualSavingsCents: true, confidence: true },
      }),
      client.suggestion.findMany({
        where: { userId: user.id },
        select: { topic: true, worthCents: true, confidencePercent: true },
      }),
    ]);
    const both = SHARED.flatMap((topic) => {
      const found = findings.filter((f) => f.type === topic && f.annualSavingsCents !== null);
      const dock = suggestions.find((s) => s.topic === topic);
      return found.length > 0 && dock ? [{ topic, found, dock }] : [];
    });
    expect(Object.fromEntries(both.map((b) => [b.topic, b.dock.worthCents]))).toEqual(
      Object.fromEntries(
        both.map((b) => [b.topic, b.found.reduce((s, f) => s + f.annualSavingsCents!, 0)]),
      ),
    );
    // One finding on a topic: the report shows the dock's %, inside the finding's level.
    const single = both.filter((b) => b.found.length === 1);
    expect(
      single.filter((b) => b.dock.confidencePercent > bandCeiling(b.found[0].confidence)),
    ).toEqual([]);
  });
});
