import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runInsuranceTool } from "@/lib/jane-agent/insurance/tools";
import { loadInsuranceSnapshot } from "@/lib/jane-agent/insurance/snapshot";
import { reviewActions } from "@/lib/jane-agent/insurance/review-words";
import { checkupPerson, latestCheckup } from "./checkups";
import { ensureDemoPolicies } from "./profile";
import { keepCovered } from "./review";
import { lowersCover } from "./saving-rules";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { listSavings, refreshSavings } from "./savings";

// The yearly insurance review against a real, migrated Postgres (spec step 202): at
// "Everything allowed" the same-cover savings are applied by Jane within the caps; below it
// nothing price-changing happens without a tap; the review is one message with a button for
// each item; and a higher deductible is never done for the person.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("the yearly insurance review, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const o = () => ({ client, now: NOW });

  async function demoPerson(autopilot: "ask" | "safe" | "all") {
    const user = await client.user.create({
      data: { email: `ins-rev-${crypto.randomUUID()}@example.com`, autopilot },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 2_000_000,
      },
    });
    if (autopilot !== "ask") {
      await setSectorAutopilot(user.id, "insurance", { level: autopilot }, o());
    }
    await ensureDemoPolicies(user.id, o());
    await refreshSavings(user.id, o());
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("at Everything allowed, applies the same-cover savings by itself and says so", async () => {
    const me = await demoPerson("all");
    const before = await listSavings(me, { client, status: "offered" });
    expect(before.filter((s) => !lowersCover(s.kind)).length).toBeGreaterThan(0);

    const checkup = await checkupPerson(me, o());
    expect(checkup).not.toBeNull();

    const after = await listSavings(me, { client, status: "offered" });
    // The free same-cover ones are done. Paying a year up front is over the default cap, a
    // safe-driver program shares data and a higher deductible lowers the cover: all wait.
    expect(after.map((s) => s.kind).sort()).toEqual(
      ["higher_deductible", "pay_in_full", "telematics"].sort(),
    );
    const acts = await client.autopilotAct.findMany({ where: { userId: me, sector: "insurance" } });
    expect(acts.length).toBeGreaterThan(0);

    const snapshot = await loadInsuranceSnapshot(me, o());
    expect(snapshot.review?.did.length).toBeGreaterThan(0);
    expect(snapshot.review?.savedYearlyCents).toBeGreaterThan(0);
  });

  it("applies paying a year up front only when it fits the caps", async () => {
    const me = await demoPerson("all");
    await setSectorAutopilot(
      me,
      "insurance",
      { actionCapCents: 300_000, monthlyCapCents: 300_000 },
      o(),
    );
    await checkupPerson(me, o());
    const after = await listSavings(me, { client, status: "offered" });
    expect(after.map((s) => s.kind).sort()).toEqual(["higher_deductible", "telematics"]);
  });

  it("below Everything allowed, nothing price-changing happens without a tap", async () => {
    for (const level of ["ask", "safe"] as const) {
      const me = await demoPerson(level);
      const before = await listSavings(me, { client, status: "offered" });
      await checkupPerson(me, o());
      expect(await listSavings(me, { client, status: "offered" }), level).toEqual(before);
      expect(await client.autopilotAct.count({ where: { userId: me } })).toBe(0);
      const snapshot = await loadInsuranceSnapshot(me, o());
      expect(snapshot.review?.did).toEqual([]);
      // One message, a button for each item: Keep me covered, and the rest.
      const actions = reviewActions(snapshot.review!);
      expect(actions.map((a) => a.id)).toContain("insurance.keep_covered");
      expect(actions.at(-1)?.id).toBe("insurance.checkup_seen");
    }
  });

  it("Keep me covered on a tap applies the same-cover savings, never a higher deductible", async () => {
    const me = await demoPerson("ask");
    const done = await keepCovered(me, { ...o(), by: "you" });
    expect(done.savings).toBeGreaterThan(0);
    const left = await listSavings(me, { client, status: "offered" });
    expect(left.map((s) => s.kind).sort()).toEqual(["higher_deductible", "telematics"]);
    expect(left.some((s) => lowersCover(s.kind))).toBe(true);
    const review = await runInsuranceTool(me, "insurance_review", {}, o());
    expect(review.content).toMatch(/review/i);
    expect((await latestCheckup(me, { client }))?.id ?? null).toBeNull();
  });
});
