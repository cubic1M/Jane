import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runDetectors } from "@/detectors";
import { SAVERS_CREDIT_DETECTORS } from "@/detectors/savers-credit";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { runTaxTool } from "@/lib/jane-agent/tax-tools-run";
import { correctFact, loadProfile, loadProfileInput } from "@/lib/profile";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { filingReadOf } from "@/planning/student-tax";
import { FILING_SINGLE_ASSUMPTION } from "@/planning/tax-profile";
import { buildProfile } from "@/profile/build";

// One GUESS (tax program T8b): a person who has not said how they file is read the same by the
// estimate, the cards and the chat's tax tool. Married filing jointly only on a sign of a partner;
// otherwise single, with the assumption line beside children; head of household only once they say.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");

describe.runIf(url)("one filing guess", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
    await client.taxCorrection.create({
      data: { userId: id, year: 2026, kind: "wages", label: "Pay", cents: 6_000_000 },
    });
  });
  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });
  // One earner with two children, nobody has said how they file.
  beforeEach(async () => {
    await client.janePreference.deleteMany({ where: { userId: id, kind: "fact" } });
    await client.userFact.deleteMany({ where: { userId: id } });
    await client.taxProfile.deleteMany({ where: { userId: id } });
    await client.taxProfile.create({
      data: { userId: id, childrenUnder17: 2, otherDependants: 0, answered: ["dependants"] },
    });
    await client.account.updateMany({
      where: { userId: id, name: "Joint checking" },
      data: { name: "Own checking" },
    });
  });

  async function everywhere() {
    const view = await loadTaxEstimate(id, { client, now: NOW });
    const chat = JSON.parse(
      (await runTaxTool(id, "tax_estimate", {}, { client, now: NOW })).content,
    ) as {
      federal: { filingStatus: string };
      assumptions: string[];
    };
    const profile = await loadProfile(id, { client, now: NOW });
    const read = filingReadOf(profile.facts);
    return {
      estimate: view.estimate.filingStatus,
      estimateLine: view.assumptions.includes(FILING_SINGLE_ASSUMPTION),
      chat: chat.federal.filingStatus,
      chatLine: chat.assumptions.includes(FILING_SINGLE_ASSUMPTION),
      cards: read.status,
      cardsLine: read.assumption === FILING_SINGLE_ASSUMPTION,
    };
  }

  it("a parent with one earner and no answer is single everywhere, with the assumption line", async () => {
    expect(await everywhere()).toEqual({
      estimate: "single",
      estimateLine: true,
      chat: "Single",
      chatLine: true,
      cards: "single",
      cardsLine: true,
    });
  });

  it("the cards that price the person carry the same line", async () => {
    const loaded = await loadProfileInput(id, { client, now: NOW });
    // About $37,440 a year: under the single limit, over none the card would pick for someone else.
    const data = {
      ...loaded,
      told: { ...loaded.told, monthly_income: 240_000, debt_trouble: false },
    };
    const card = runDetectors({ profile: buildProfile(data), data }, SAVERS_CREDIT_DETECTORS).find(
      (s) => s.topic === "savers_credit",
    );
    expect(card?.why).toContain(FILING_SINGLE_ASSUMPTION);
  });

  it("a joint account makes everything joint, with nothing assumed", async () => {
    await client.account.updateMany({
      where: { userId: id, name: "Own checking" },
      data: { name: "Joint checking" },
    });
    expect(await everywhere()).toEqual({
      estimate: "married_joint",
      estimateLine: false,
      chat: "Married filing jointly",
      chatLine: false,
      cards: "married_joint",
      cardsLine: false,
    });
  });

  it("a partner the person told Jane about makes everything joint", async () => {
    await correctFact(id, "has_partner", "yes", { client, now: NOW });
    expect(await everywhere()).toMatchObject({
      estimate: "married_joint",
      chat: "Married filing jointly",
      cards: "married_joint",
    });
  });

  it("once the person answers head of household, everything says it and assumes nothing", async () => {
    await correctFact(id, "filing_status", "head_of_household", { client, now: NOW });
    expect(await everywhere()).toEqual({
      estimate: "head_of_household",
      estimateLine: false,
      chat: "Head of household",
      chatLine: false,
      cards: "head_of_household",
      cardsLine: false,
    });
  });
});
