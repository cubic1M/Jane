import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The concierge flow is what's tested here (the demo bank and trial people get it); read-only
// mode for real accounts is in src/lib/decisions.integration.test.ts.
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: vi.fn(async () => true) }));

import { findingOfType } from "./__fixtures__/findings";
import { AutopilotError, autopilotOf, markCustom, setAutopilot } from "./autopilot";
import { rulesFor } from "./standing-rules";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("autopilot against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `autopilot-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    for (const type of [
      "bank_fees",
      "duplicate_charge",
      "idle_cash",
      "bill_negotiation",
    ] as const) {
      const f = findingOfType(type);
      await client.finding.create({
        data: {
          userId: user.id,
          type: f.type,
          key: `${f.key}-${crypto.randomUUID()}`,
          title: f.title,
          annualSavingsCents: f.annualSavingsCents,
          amountCents: f.amountCents,
          confidence: f.confidence,
          evidence: f.evidence as Prisma.InputJsonObject,
        },
      });
    }
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("starts unchosen, and the safe level approves only no-risk items at once", async () => {
    const userId = await person();
    expect(await autopilotOf(userId, { client })).toBeNull();
    expect(await setAutopilot(userId, "safe", { client })).toBe(2);
    expect(await autopilotOf(userId, { client })).toBe("safe");

    const decided = await client.decision.findMany({
      where: { userId },
      include: { finding: { select: { type: true } } },
    });
    expect(decided.map((d) => d.finding.type).sort()).toEqual(["bank_fees", "duplicate_charge"]);
    expect(decided.every((d) => d.source === "rule")).toBe(true);
    // Moving money and calls still wait for a yes.
    expect(
      await client.finding.count({
        where: { userId, type: { in: ["idle_cash", "bill_negotiation"] }, status: "new" },
      }),
    ).toBe(2);
  });

  it("asks first when told to, and becomes custom when rules are fine-tuned", async () => {
    const userId = await person();
    await setAutopilot(userId, "safe", { client });
    await setAutopilot(userId, "all", { client });
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: userId } })).acceptSimpleOffers,
    ).toBe(true);
    expect(await setAutopilot(userId, "ask", { client })).toBe(0);
    expect(
      (await client.user.findUniqueOrThrow({ where: { id: userId } })).acceptSimpleOffers,
    ).toBe(false);
    expect((await rulesFor(userId, { client })).every((r) => !r.enabled)).toBe(true);
    await markCustom(userId, { client });
    expect(await autopilotOf(userId, { client })).toBe("custom");
    await expect(setAutopilot(userId, "everything", { client })).rejects.toBeInstanceOf(
      AutopilotError,
    );
  });
});
