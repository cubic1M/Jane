import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadFiling } from "@/lib/filing-status";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { deletePreference } from "@/lib/jane-agent/preferences";
import { runTaxTool } from "@/lib/jane-agent/tax-tools-run";
import { forgetEverything, forgetFact, listFacts } from "@/lib/memory/facts";
import { clearCorrection, correctFact, loadProfile } from "@/lib/profile";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxProfile, saveTaxAnswers } from "@/lib/tax-profile";
import { filingStatusOf } from "@/planning/student-tax";

// Taking back how a person files (walk hold on da81c3495): the told answer and the tax profile's copy
// of it (src/lib/told-mirrors.ts) go together by every path a person has to forget it. Afterwards the
// person is "not said" on every surface: the Taxes page, the estimate (with its assumption line), the
// chat's tax tool, What Jane knows and the detectors' facts, and the tax profile row holds nothing.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");

describe.runIf(url)("forgetting takes the copies back", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let id: string;
  let other: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
    other = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
    await client.taxCorrection.create({
      data: { userId: id, year: 2026, kind: "wages", label: "Pay", cents: 6_000_000 },
    });
  });
  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await deleteCheckPerson(other, { client }).catch(() => {});
    await client.$disconnect();
  });
  beforeEach(async () => {
    for (const userId of [id, other]) {
      await client.janePreference.deleteMany({ where: { userId, kind: "fact" } });
      await client.userFact.deleteMany({ where: { userId } });
      await client.taxProfile.deleteMany({ where: { userId } });
      await client.investorProfile.deleteMany({ where: { userId } });
      await client.insuranceProfile.deleteMany({ where: { userId } });
    }
  });

  // Every place a person sees how they file, read now.
  async function everywhere() {
    const view = await loadTaxEstimate(id, { client, now: NOW });
    const chat = (
      JSON.parse((await runTaxTool(id, "tax_profile", {}, { client, now: NOW })).content) as {
        filingStatus: { name: string } | null;
      }
    ).filingStatus?.name;
    const profile = await loadProfile(id, { client, now: NOW });
    return {
      page: (await loadTaxProfile(id, { client, now: NOW })).filingStatus.value,
      estimate: view.estimate.filingStatus,
      assumed: view.assumptions.some((a) => a.startsWith("You haven't told me how you file")),
      chat,
      detectors: filingStatusOf(profile.facts),
      told: profile.facts.filing_status.value,
      known: (await listFacts(id, { client })).some((f) => f.key === "filing_status"),
      load: (await loadFiling(id, { client })).read.status,
      saidAtAll: await loadFiling(id, { client }).then(
        (f) => f.told !== null || f.stored?.filingStatus != null,
      ),
    };
  }
  const notSaid = {
    page: null,
    estimate: "single",
    assumed: true,
    chat: undefined,
    detectors: "single",
    told: null,
    known: false,
    load: "single",
    saidAtAll: false,
  };

  async function saveRow() {
    return client.taxProfile.findFirst({
      where: { userId: id },
      select: { filingStatus: true, answered: true },
    });
  }

  const says = {
    card: async () => correctFact(id, "filing_status", "married_joint", { client, now: NOW }),
    form: async () =>
      saveTaxAnswers(id, [{ field: "filingStatus", value: "married_joint" }], {
        client,
        now: NOW,
        via: "page",
      }),
  };
  const paths: Record<string, () => Promise<unknown>> = {
    // Settings > What Jane knows > Forget.
    "Forget on What Jane knows": async () => {
      const fact = (await listFacts(id, { client })).find((f) => f.key === "filing_status");
      expect(await forgetFact(id, fact!.id, { client })).toBe(true);
    },
    // Settings > What Jane knows > Delete all memory.
    "Delete all memory": () => forgetEverything(id, { client }),
    // Settings > what Jane remembers > delete one preference.
    "a deleted preference": async () => {
      const pref = await client.janePreference.findFirstOrThrow({
        where: { userId: id, key: "profile:filing_status" },
      });
      expect(await deletePreference(id, pref.id, { client })).toBe(true);
    },
    // Your profile > take back a correction.
    "a cleared correction": async () => {
      expect(await clearCorrection(id, "filing_status", { client })).toBe(true);
    },
  };

  for (const [how, say] of Object.entries(says)) {
    for (const [path, forget] of Object.entries(paths)) {
      it(`answered by the ${how}, then taken back by ${path}: not said everywhere`, async () => {
        await say();
        expect((await everywhere()).page).toBe("married_joint");
        expect((await saveRow())?.filingStatus).toBe("married_joint");
        await forget();
        expect(await everywhere()).toEqual(notSaid);
        const row = await saveRow();
        expect(row?.filingStatus ?? null).toBeNull();
        expect(row?.answered ?? []).not.toContain("filingStatus");
        // Said again afterwards, it is the new answer: the take-back left nothing in the way.
        await correctFact(id, "filing_status", "head_of_household", { client, now: NOW });
        expect((await everywhere()).page).toBe("head_of_household");
      });
    }
  }

  it("forgetting leaves the rest of the tax profile and another person's answer alone", async () => {
    await client.taxProfile.create({ data: { userId: id, state: "CA", answered: ["state"] } });
    await says.card();
    await correctFact(other, "filing_status", "single", { client, now: NOW });
    const fact = (await listFacts(id, { client })).find((f) => f.key === "filing_status");
    await forgetFact(id, fact!.id, { client });
    const mine = await client.taxProfile.findFirstOrThrow({ where: { userId: id } });
    expect(mine).toMatchObject({ state: "CA", filingStatus: null, answered: ["state"] });
    const theirs = await client.taxProfile.findFirstOrThrow({ where: { userId: other } });
    expect(theirs).toMatchObject({ filingStatus: "single" });
    expect(theirs.answered).toContain("filingStatus");
    await forgetEverything(id, { client });
    expect(
      (await client.taxProfile.findFirstOrThrow({ where: { userId: other } })).filingStatus,
    ).toBe("single");
  });

  it("a different answer on the tax profile stays when an older told answer is forgotten", async () => {
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
      },
    });
    await forgetEverything(id, { client });
    expect((await saveRow())?.filingStatus).toBe("head_of_household");
  });

  describe("the other told answers copied into another table", () => {
    const readTaxRow = () =>
      client.taxProfile.findFirstOrThrow({
        where: { userId: id },
        select: { childrenUnder17: true, otherDependants: true, answered: true },
      });

    for (const [path, forget] of Object.entries(paths)) {
      it(`children, age and own or rent are taken back by ${path}`, async () => {
        await correctFact(id, "has_children", "yes", { client, now: NOW });
        await correctFact(id, "age", "34", { client, now: NOW });
        await correctFact(id, "housing", "rent", { client, now: NOW });
        expect((await readTaxRow()).childrenUnder17).toBe(1);
        expect((await client.investorProfile.findFirstOrThrow({ where: { userId: id } })).age).toBe(
          34,
        );
        // Each path forgets one fact at a time or all of them; do the one it can name, then the rest.
        for (const fact of ["has_children", "age", "housing"]) {
          const pref = await client.janePreference.findFirst({
            where: { userId: id, key: `profile:${fact}` },
          });
          if (!pref) continue;
          if (path === "Forget on What Jane knows") {
            const known = (await listFacts(id, { client })).find((f) => f.key === fact);
            await forgetFact(id, known!.id, { client });
          } else if (path === "a deleted preference") {
            await deletePreference(id, pref.id, { client });
          } else if (path === "a cleared correction") {
            await clearCorrection(id, fact, { client });
          }
        }
        if (path === "Delete all memory") await forget();
        const row = await readTaxRow();
        expect(row.childrenUnder17).toBeNull();
        expect(row.answered).not.toContain("dependants");
        expect(
          (await client.investorProfile.findFirstOrThrow({ where: { userId: id } })).age,
        ).toBeNull();
        expect(
          (await client.insuranceProfile.findFirstOrThrow({ where: { userId: id } })).housing,
        ).toBeNull();
      });
    }

    it("a count of children given on the tax profile form stays when the yes is forgotten", async () => {
      await correctFact(id, "has_children", "yes", { client, now: NOW });
      await saveTaxAnswers(id, [{ field: "dependants", childrenUnder17: 2, otherDependants: 1 }], {
        client,
        now: NOW,
        via: "page",
      });
      await forgetEverything(id, { client });
      expect(await readTaxRow()).toMatchObject({ childrenUnder17: 2, otherDependants: 1 });
    });
  });
});
