import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { FamilyTaxesError, loadFamilyTaxes, saveFamilyDetails } from "@/lib/family-taxes";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxProfile, saveTaxAnswers } from "@/lib/tax-profile";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 169 against a real, migrated Postgres: the demo person, married with two
// children, pays for daycare. In demo advice mode Jane shows each family choice with both
// sides' tax, brings up the one worth making, and filing status can be set from the chat.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("family taxes against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  async function family(prefix: string, spouseWagesCents: number) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    for (const month of ["06", "07", "08", "09"]) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date(`2026-${month}-01T00:00:00Z`),
          amountCents: 120_000,
          description: "LITTLE STARS DAYCARE",
          merchantName: "Little Stars Daycare",
          pfcDetailed: "GENERAL_SERVICES_CHILDCARE",
        },
      });
    }
    await saveTaxAnswers(
      user.id,
      [
        { field: "filingStatus", value: "married_joint" },
        { field: "dependants", childrenUnder17: 2, otherDependants: 0 },
      ],
      { client, via: "page" },
    );
    await saveFamilyDetails(
      user.id,
      {
        children: [
          { ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 12 },
          { ageAtYearEnd: 9, hasSsn: true, monthsLivedWithYou: 12 },
        ],
        spouseWagesCents,
        paysOverHalfHome: null,
        student: null,
      },
      { client, via: "page" },
    );
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("shows each family choice with both sides' tax", async () => {
    const userId = await family("family", 4_000_000);
    const view = await loadFamilyTaxes(userId, { client, now: LINKED });
    expect(view.advice).toBe(true);
    // The demo bank's online course isn't tuition: no education credit choice.
    expect(view.choices.map((c) => c.key)).toEqual(["children", "care", "filing"]);
    for (const c of view.choices) {
      expect(c.sides).toHaveLength(2);
      for (const s of c.sides)
        expect(Number.isInteger(s.taxCents), `${c.key} ${s.label}`).toBe(true);
    }
    const care = view.choices.find((c) => c.key === "care")!;
    expect(care.sides.every((s) => s.eligible)).toBe(true);
    expect(care.savesCents).toBe(Math.abs(care.sides[0].taxCents - care.sides[1].taxCents));
    const filing = view.choices.find((c) => c.key === "filing")!;
    expect(filing.sides.map((s) => s.label)).toEqual([
      "Married filing jointly",
      "Married filing separately (both returns)",
    ]);
    expect(filing.better).toBe(0);
  });

  it("brings up the childcare choice, not filing status already right", async () => {
    const userId = await family("family-msg", 4_000_000);
    const candidates = taxesSource.gather(
      (await loadSnapshot(userId, { client, now: LINKED }))!,
      context,
    );
    const care = candidates.find((c) => c.dedupeKey === "family:2026:care")!;
    expect(care.body).toMatch(
      /^Childcare: a dependent care FSA or the credit:\n• Pay \$[\d,]+ of care from a dependent care FSA: tax about \$[\d,]+/,
    );
    expect(care.refs.advice).toBe(true);
    expect(candidates.some((c) => c.dedupeKey === "family:2026:filing")).toBe(false);
    expect(candidates.some((c) => c.dedupeKey === "family:2026:children")).toBe(false);
  });

  it("offers the better filing status with one tap when the profile has the other", async () => {
    const userId = await family("family-file", 4_000_000);
    await saveTaxAnswers(userId, [{ field: "filingStatus", value: "married_separate" }], {
      client,
      via: "page",
    });
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((c) => c.dedupeKey === "family:2026:filing")!;
    expect(candidate.body).toMatch(/Married filing jointly saves about \$[\d,]+ for 2026\./);
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
    expect(parseActions(message.actions).map((a) => [a.id, a.label])).toEqual([
      ["tax.filing_joint", "File as married filing jointly"],
      ["open", "See family taxes"],
    ]);
    await takeChatAction(userId, message.id, "tax.filing_joint", { client, now: LINKED });
    expect((await loadTaxProfile(userId, { client, now: LINKED })).filingStatus.value).toBe(
      "married_joint",
    );
  });

  it("answers should we file jointly or separately, and gives Claude the choices", async () => {
    const userId = await family("family-chat", 4_000_000);
    const { reply } = await sendToJane(userId, "should we file jointly or separately", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(/^Your family tax choices for 2026, each side's federal tax/);
    expect(reply.body).toContain(
      "Married: file jointly or separately:\n• Married filing jointly: tax about",
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_family", {}, { client, now: LINKED })).content,
    );
    expect(tool.choices.map((c: { choice: string }) => c.choice)).toContain(
      "Childcare: a dependent care FSA or the credit",
    );
    expect(tool.choices[0].sides[0]).toMatchObject({ open: true, less: true });
  });

  it("compares the education credits for tuition paid to a school", async () => {
    const userId = await family("family-school", 4_000_000);
    const checking = await client.account.findFirstOrThrow({
      where: { userId, subtype: "checking" },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-08-20T00:00:00Z"),
        amountCents: 450_000,
        description: "STATE UNIVERSITY BURSAR",
        merchantName: "State University",
        pfcDetailed: "GENERAL_SERVICES_EDUCATION",
      },
    });
    const view = await loadFamilyTaxes(userId, { client, now: LINKED });
    const education = view.choices.find((c) => c.key === "education")!;
    expect(education.sides.map((s) => s.label)).toEqual([
      "American Opportunity Credit ($2,500)",
      "Lifetime Learning Credit ($900)",
    ]);
    expect(education.better).toBe(0);
    expect(view.assumptions).toContain(
      "I've assumed the student is in their first four years of college, at least half-time.",
    );
  });

  it("checks the family details, and shows nothing for real accounts", async () => {
    const userId = await family("family-check", 0);
    await expect(
      saveFamilyDetails(
        userId,
        {
          children: [{ ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 13 }],
          spouseWagesCents: null,
          paysOverHalfHome: null,
          student: null,
        },
        { client, via: "page" },
      ),
    ).rejects.toBeInstanceOf(FamilyTaxesError);

    const real = await client.user.create({
      data: { email: `family-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    expect((await loadFamilyTaxes(real.id, { client, now: LINKED })).choices).toEqual([]);
  });
});
