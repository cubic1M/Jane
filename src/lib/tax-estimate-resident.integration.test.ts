import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { estimateTaxes } from "@/planning/tax-estimate";

// Tax T4 (5): a person whose residency Jane does not know gets no earned income credit in the page's
// estimate AND in every re-run of the pure estimator on its input (the what-ifs).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");

describe.runIf(url)("what-ifs for a person whose residency is not established", () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
    // About $10,000 of pay so far: low enough for the credit. Residency is not told.
    await client.taxCorrection.create({
      data: { userId: id, year: 2026, kind: "wages", label: "Pay", cents: 1_000_000 },
    });
  });

  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  it("carries the flag on the view's input, so every what-if re-run leaves the credit out", async () => {
    const view = await loadTaxEstimate(id, { client, now: NOW });
    expect(view.input.residentCreditsAllowed).toBe(false);
    expect(view.estimate.credits.earnedIncomeCreditCents).toBe(0);
    // The same input with the flag taken off would have counted a credit: it is the flag that holds it.
    const allowed = estimateTaxes({ ...view.input, residentCreditsAllowed: true });
    expect(allowed.credits.earnedIncomeCreditCents).toBeGreaterThan(0);
    const reruns = [
      { ...view.input, childrenUnder17: 2, filingStatus: "head_of_household" as const },
      {
        ...view.input,
        income: {
          ...view.input.income,
          wagesCents: 2_000_000,
          socialSecurityWagesCents: 2_000_000,
        },
      },
      { ...view.input, charityCents: 100_000 },
    ];
    for (const input of reruns) {
      expect(estimateTaxes(input).credits.earnedIncomeCreditCents).toBe(0);
    }
  });
});
