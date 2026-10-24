import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PERSON_IDS, type PersonId } from "@/config/people";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { detectFor } from "@/lib/suggestions";

// Real-user QA (2026-10-23): a real account (a CSV import) was told "Add disability cover for
// your pay" and "Try practice money first". Cover to buy, raise or switch, and the practice
// portfolio, are demo advice: real accounts get none of them, the demo bank's people still do.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const RECOMMENDATIONS = [
  "disability_insurance",
  "renters_insurance",
  "umbrella",
  "liability_levels",
  "deductible_fit",
  "insurance_shopping",
  "practice_portfolio",
];

describe.runIf(url)("insurance recommendations and real accounts", { timeout: 600_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;
  async function person(id: PersonId, real: boolean) {
    const user = await client.user.create({
      data: { email: `real-advice-${id}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    // A CSV account next to the demo bank turns demo advice off (src/lib/advice-mode.ts).
    if (real)
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Credit union checking",
          type: "depository",
          currentBalanceCents: 100_000,
        },
      });
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("lists each as advice", () => {
    for (const t of RECOMMENDATIONS) expect(ADVICE_TOPICS as readonly string[]).toContain(t);
  });

  it("gives them to the demo bank's people and none to a real account", async () => {
    const seen = new Set<string>();
    for (const id of PERSON_IDS) {
      const demo = await detectFor(await person(id, false), { client, now: NOW });
      for (const s of demo.suggestions) if (RECOMMENDATIONS.includes(s.topic)) seen.add(s.topic);
      const real = await detectFor(await person(id, true), { client, now: NOW });
      expect(real.advice, id).toBe(false);
      expect(
        real.suggestions.filter((s) => RECOMMENDATIONS.includes(s.topic)).map((s) => s.topic),
        id,
      ).toEqual([]);
    }
    // The walk found these on the sample people.
    for (const t of ["disability_insurance", "umbrella"]) {
      expect(seen).toContain(t);
    }
  });
});
