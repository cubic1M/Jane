import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { FilingStatus } from "@/config/tax";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { runTaxTool } from "@/lib/jane-agent/tax-tools-run";
import { loadFiling } from "@/lib/filing-status";
import { clearCorrection, correctFact, loadProfile } from "@/lib/profile";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxProfile, saveTaxAnswers } from "@/lib/tax-profile";
import { filingStatusOf } from "@/planning/student-tax";

// One filing status (tax program T8): the question card's answer and the tax profile's own row are
// one answer. A card answer reaches the estimate, the Taxes page and the chat; a profile form answer
// reaches the detectors; two stores that already disagree are settled by the newer answer.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");
const LATER = new Date("2026-11-06T03:00:00Z");

const WORDS: Record<FilingStatus, string> = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
};

describe.runIf(url)("one filing status", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    // An account of their own beside the demo bank: not a sample person, so nothing is answered yet.
    id = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
    await client.taxCorrection.create({
      data: { userId: id, year: 2026, kind: "wages", label: "Pay", cents: 6_000_000 },
    });
  });
  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });
  // Several tests read the same person in different states: nothing is kept between them.
  beforeEach(async () => {
    await client.janePreference.deleteMany({
      where: { userId: id, kind: "fact", key: "profile:filing_status" },
    });
    await client.userFact.deleteMany({ where: { userId: id, key: "filing_status" } });
    await client.taxProfile.deleteMany({ where: { userId: id } });
    await client.auditLog.deleteMany({ where: { targetId: id } });
  });

  // Every place a person can see how they file, read for them now.
  async function everywhere(now = NOW) {
    const estimate = (await loadTaxEstimate(id, { client, now })).estimate.filingStatus;
    const page = (await loadTaxProfile(id, { client, now })).filingStatus.value;
    const chat = (
      JSON.parse((await runTaxTool(id, "tax_profile", {}, { client, now })).content) as {
        filingStatus: { name: string } | null;
      }
    ).filingStatus?.name;
    const profile = await loadProfile(id, { client, now });
    const detectors = filingStatusOf(profile.facts);
    const told = profile.facts.filing_status.value;
    return { estimate, page, chat, detectors, told };
  }
  const allSay = (seen: Awaited<ReturnType<typeof everywhere>>, status: FilingStatus) =>
    expect(seen).toEqual({
      estimate: status,
      page: status,
      chat: WORDS[status],
      detectors: status,
      told: status,
    });

  it("a card answer reaches the estimate, the page, the chat and the detectors", async () => {
    await correctFact(id, "filing_status", "head_of_household", { client, now: NOW });
    allSay(await everywhere(), "head_of_household");
    // And it is on the tax profile's own row, marked answered, like the children mirror.
    const row = await client.taxProfile.findUniqueOrThrow({ where: { userId: id } });
    expect(row.filingStatus).toBe("head_of_household");
    expect(row.answered).toContain("filingStatus");
  });

  it("a profile form answer reaches the card's fact and the detectors", async () => {
    await saveTaxAnswers(id, [{ field: "filingStatus", value: "married_separate" }], {
      client,
      now: NOW,
      via: "page",
    });
    allSay(await everywhere(), "married_separate");
    const pref = await client.janePreference.findFirstOrThrow({
      where: { userId: id, key: "profile:filing_status" },
    });
    expect(pref.value).toEqual({ value: "married_separate", at: NOW.toISOString() });
    // The memory's fact too, so the chat's memory says the same.
    const fact = await client.userFact.findFirstOrThrow({
      where: { userId: id, key: "filing_status", supersededById: null },
    });
    expect(fact.value).toEqual({ value: "married_separate" });
  });

  it("a later answer on either side replaces an earlier one, everywhere", async () => {
    await correctFact(id, "filing_status", "single", { client, now: NOW });
    allSay(await everywhere(), "single");
    await saveTaxAnswers(id, [{ field: "filingStatus", value: "married_joint" }], {
      client,
      now: LATER,
      via: "chat",
    });
    allSay(await everywhere(LATER), "married_joint");
    await correctFact(id, "filing_status", "head_of_household", { client, now: LATER });
    allSay(await everywhere(LATER), "head_of_household");
  });

  it("taking the card's answer back takes the profile's copy of it back, and Jane reads what it sees", async () => {
    await correctFact(id, "filing_status", "married_joint", { client, now: NOW });
    allSay(await everywhere(), "married_joint");
    expect(await clearCorrection(id, "filing_status", { client })).toBe(true);
    const seen = await everywhere();
    expect(seen).toMatchObject({ page: null, told: null, chat: undefined });
    const row = await client.taxProfile.findUniqueOrThrow({ where: { userId: id } });
    expect(row.filingStatus).toBeNull();
    expect(row.answered).not.toContain("filingStatus");
  });

  it("taking the card's answer back leaves a different answer on the profile alone", async () => {
    await client.taxProfile.create({
      data: { userId: id, filingStatus: "head_of_household", answered: ["filingStatus"] },
    });
    await client.janePreference.create({
      data: {
        userId: id,
        kind: "fact",
        key: "profile:filing_status",
        value: { value: "single" },
        label: "How you file taxes: single",
        createdAt: new Date("2026-01-01T12:00:00Z"),
      },
    });
    await clearCorrection(id, "filing_status", { client });
    expect((await everywhere()).page).toBe("head_of_household");
  });

  describe("people whose two stores already disagree (saved before the stores were joined)", () => {
    // How it was: a question-card answer saved with no time inside it, and a profile row.
    const oldTold = (value: FilingStatus, createdAt: Date) =>
      client.janePreference.create({
        data: {
          userId: id,
          kind: "fact",
          key: "profile:filing_status",
          value: { value },
          label: `How you file taxes: ${value}`,
          createdAt,
        },
      });
    // The profile form's save, as it was logged then: the row and the audit entry that names it.
    const oldProfile = async (filingStatus: FilingStatus, at: Date) => {
      await client.taxProfile.create({
        data: { userId: id, filingStatus, answered: ["filingStatus"], updatedAt: at },
      });
      await client.auditLog.create({
        data: {
          actorType: "user",
          actorId: id,
          event: "tax_profile_changed",
          targetType: "user",
          targetId: id,
          metadata: { fields: "filingStatus", via: "page" },
          createdAt: at,
        },
      });
    };

    it("the newer answer is read by the page, the chat, the estimate and the detectors", async () => {
      // The profile form said married filing jointly after the card said single.
      await oldTold("single", new Date("2026-09-01T12:00:00Z"));
      await oldProfile("married_joint", new Date("2026-10-01T12:00:00Z"));
      allSay(await everywhere(), "married_joint");
      expect((await loadFiling(id, { client })).read.replaced).toBe("single");
    });

    it("the card's answer wins when it is the newer one", async () => {
      await oldProfile("married_joint", new Date("2026-09-01T12:00:00Z"));
      await oldTold("single", new Date("2026-10-01T12:00:00Z"));
      allSay(await everywhere(), "single");
    });

    it("tells 3pm from 7pm, either side of UTC midnight, by the instant and not the day", async () => {
      // 3pm Pacific on Nov 5 is 23:00Z that day, 7pm Pacific is 03:00Z the next. The person's day is
      // the same; the later answer is still the later.
      await oldTold("single", new Date("2026-11-05T23:00:00Z"));
      await oldProfile("head_of_household", new Date("2026-11-06T03:00:00Z"));
      allSay(await everywhere(), "head_of_household");
    });

    it("with no time to tell them apart, what the person told Jane on the card wins", async () => {
      const at = new Date("2026-10-01T12:00:00Z");
      await oldTold("single", at);
      await oldProfile("married_joint", at);
      allSay(await everywhere(), "single");
    });

    it("a profile row with no save on record, changed later for something else, does not outrank the card", async () => {
      // A row from before saves were logged (or a seeded one): its updated_at moves with the state.
      await oldTold("single", new Date("2026-10-01T12:00:00Z"));
      await client.taxProfile.create({
        data: {
          userId: id,
          filingStatus: "married_joint",
          state: "CA",
          answered: ["filingStatus", "state"],
          updatedAt: new Date("2026-11-01T12:00:00Z"),
        },
      });
      allSay(await everywhere(), "single");
    });

    it("a card answer from before times were kept is dated by its own save, not by memory's other answer", async () => {
      await oldTold("single", new Date("2026-09-01T12:00:00Z"));
      await client.userFact.create({
        data: {
          userId: id,
          key: "filing_status",
          value: { value: "married_joint" },
          label: "How you file taxes: married joint",
          source: "answer",
          confidence: 100,
          firstSeen: new Date("2026-11-01T12:00:00Z"),
          lastConfirmed: new Date("2026-11-01T12:00:00Z"),
        },
      });
      // The profile form's answer sits between the two dates, and is newer than the card's.
      await oldProfile("head_of_household", new Date("2026-10-01T12:00:00Z"));
      allSay(await everywhere(), "head_of_household");
    });

    it("an answer whose stores agree, or only one store, reads the same", async () => {
      await oldProfile("married_joint", new Date("2026-10-01T12:00:00Z"));
      allSay(await everywhere(), "married_joint");
    });
  });

  it("a person who has said nothing gets the same guess on every surface that has the signs", async () => {
    const seen = await everywhere();
    // Nothing told: no fact, a guess from the accounts (none here) or single; never a surprise.
    expect(seen.told).toBeNull();
    expect(seen.page).toBeNull();
    expect(seen.estimate).toBe("single");
    expect(seen.detectors).toBe("single");
  });
});
