import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { INSIGHT_MONTHS } from "@/config/insights";
import { loadInsightTransactions } from "@/insights/load";
import { spendingInsights } from "@/insights/spending";
import { scopedFor } from "@/lib/db-scoped";
import { addGoal } from "@/lib/goals";
import { homeSummary } from "@/lib/home";
import { drawBlock } from "./blocks";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { sendToJane } from "./typing";
import { toView } from "./view";

// Spec step 94 against a real, migrated Postgres and the demo bank: typed answers carry a
// block whose figures are the pages' own, drawn to fit a phone with a text alternative.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe.runIf(url)("rich answers against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("shows what's due as a timeline, from Today's rows", async () => {
    const { reply } = await sendToJane(userId, "what's due this week", { client, now: at(1) });
    const home = await homeSummary(userId, { client, now: at(1) });
    const week = (home?.comingUp ?? []).filter((r) => r.daysLeft <= 7);
    expect(reply.refs.block).toEqual({
      type: "timeline",
      title: "Due this week",
      rows: week.map((r) => ({ date: r.date, label: r.label, cents: r.amountCents })),
    });
    const view = toView(reply, at(1), null);
    expect(view.block?.lines.every((l) => l.length <= 34)).toBe(true);
    expect(view.block?.alt).toMatch(/^Due this week: /);
  });

  it("shows where the money went as bars, from Insights' totals", async () => {
    const { reply } = await sendToJane(userId, "how much did I spend this month", {
      client,
      now: at(2),
    });
    const insights = spendingInsights(
      await loadInsightTransactions(scopedFor(userId, client), "2026-10-18", INSIGHT_MONTHS),
      { asOf: "2026-10-18", monthCount: INSIGHT_MONTHS },
    );
    const top = insights.categoriesByMonth["2026-10"].filter((c) => c.cents > 0);
    const block = reply.refs.block!;
    expect(block.type).toBe("bars");
    expect(block.type === "bars" && block.rows[0]).toEqual({
      label: top[0].category,
      cents: top[0].cents,
    });
  });

  it("shows goals as progress bars", async () => {
    await addGoal(
      userId,
      { name: "Trip", target: "900.00", targetDate: "2027-03-01", accountId: "", saved: "" },
      { client },
    );
    const { reply } = await sendToJane(userId, "how are my goals doing", { client, now: at(3) });
    expect(reply.body).toMatch(/^Your goal is on track\./);
    expect(reply.refs.block?.type).toBe("progress");
    expect(drawBlock(reply.refs.block!).alt).toContain("Trip: $0.00 of $900.00, 0%");
  });
});
