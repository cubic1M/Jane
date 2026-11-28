import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const hoisted = vi.hoisted(() => ({ later: [] as (() => Promise<void>)[] }));
// What runs after the reply: collected, and run when the test says the reply has gone out.
vi.mock("next/server", () => ({
  after: (run: () => Promise<void>) => void hoisted.later.push(run),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { forgetEverything, forgetFact, listFacts } from "@/lib/memory/facts";
import { clearCorrection, correctFact } from "@/lib/profile";
import { saveTaxAnswers } from "@/lib/tax-profile";

// "An answer changes the cards at once" (walk on da81c3495): the cards on the Taxes page are the
// stored suggestions of the last scan. After the answer that decides whether one applies, in either
// direction, and after a forget, the scan runs again after the reply: no waiting for an upload or the
// nightly scan.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");
const CREDITS = ["earned_income_credit", "education_credit"];

describe.runIf(url)("an answer changes the cards", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
    // Low pay into their own account, every two weeks since August: under the earned income
    // credit's limit, so the credit's card fires once they are a citizen.
    const account = await client.account.findFirstOrThrow({ where: { userId: id, source: "csv" } });
    // Only that pay: the demo bank's own pay is well over the limit.
    await client.transaction.deleteMany({ where: { userId: id, accountId: { not: account.id } } });
    await client.transaction.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        userId: id,
        accountId: account.id,
        source: "csv" as const,
        dedupeKey: `answer-rescans-pay-${i}`,
        date: new Date(Date.UTC(2026, 7, 7 + i * 14)),
        amountCents: -50_000,
        description: "ACME PAYROLL",
        merchantName: "Acme Payroll",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_WAGES",
      })),
    });
  });
  afterAll(async () => {
    if (id) await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });
  beforeEach(async () => {
    await client.janePreference.deleteMany({ where: { userId: id, kind: "fact" } });
    await client.userFact.deleteMany({ where: { userId: id } });
    await client.suggestion.deleteMany({ where: { userId: id } });
    // What the earned income credit's card needs besides the status: 25 or older, not a dependent.
    await correctFact(id, "age_25_plus", "yes", { client, now: NOW });
    await correctFact(id, "claimed_as_dependent", "no", { client, now: NOW });
    hoisted.later.length = 0;
  });

  // The reply has gone out: what was left for after it runs.
  const afterTheReply = async () => {
    for (const run of hoisted.later.splice(0)) await run();
  };
  const cards = async () =>
    (
      await client.suggestion.findMany({
        where: { userId: id, topic: { in: CREDITS }, status: { not: "gone" } },
      })
    )
      .map((s) => s.topic)
      .sort();

  it("a citizen's credit card comes at once, and goes at once when it becomes a student visa", async () => {
    await correctFact(id, "tax_residency", "student_visa", { client, now: NOW });
    await afterTheReply();
    expect(await cards()).toEqual([]);

    await correctFact(id, "tax_residency", "citizen", { client, now: NOW });
    // Not before the reply has gone out.
    expect(await cards()).toEqual([]);
    await afterTheReply();
    expect(await cards()).toContain("earned_income_credit");

    await correctFact(id, "tax_residency", "student_visa", { client, now: NOW });
    await afterTheReply();
    expect(await cards()).toEqual([]);
  });

  it("every way of forgetting the answer takes the card away at once", async () => {
    const say = async () => {
      await correctFact(id, "tax_residency", "citizen", { client, now: NOW });
      await afterTheReply();
      expect(await cards()).toContain("earned_income_credit");
    };
    // Settings > What Jane knows > Forget: the scan is queued for after the reply (immigration status
    // itself is never kept in What Jane knows, so the card is flipped below by the other paths).
    await say();
    const fact = (await listFacts(id, { client })).find((f) => f.key === "age_25_plus");
    hoisted.later.length = 0;
    await forgetFact(id, fact!.id, { client, now: NOW });
    expect(hoisted.later).toHaveLength(1);
    await afterTheReply();
    await correctFact(id, "age_25_plus", "yes", { client, now: NOW });
    await afterTheReply();
    expect(await cards()).toContain("earned_income_credit");
    // Delete all memory: the card goes.
    await forgetEverything(id, { client });
    await afterTheReply();
    expect(await cards()).toEqual([]);
    // Your profile > take back the answer.
    await correctFact(id, "age_25_plus", "yes", { client, now: NOW });
    await say();
    await clearCorrection(id, "tax_residency", { client });
    await afterTheReply();
    expect(await cards()).toEqual([]);
  });

  it("the tax profile's own answers and the chat's scan again too", async () => {
    await saveTaxAnswers(id, [{ field: "state", value: "CA" }], { client, now: NOW, via: "chat" });
    expect(hoisted.later).toHaveLength(1);
    await afterTheReply();
  });
});
