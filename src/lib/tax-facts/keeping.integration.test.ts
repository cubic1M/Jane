import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadTaxHousehold } from "@/lib/tax-facts/load";
import { markNeedsRepair } from "@/lib/tax-facts/repair";
import { forgetTaxFacts, recordTaxFact } from "@/lib/tax-facts/write";
import { fact } from "@/planning/tax-engine/facts";

// Step T9, the record keeps up with the older stores and lets go of what the person takes back: a
// write that did not land is copied again, an older save never undoes a newer one, a child keeps
// their own facts when another is removed, and a forgotten answer is gone from every row.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-27T18:00:00Z");
const YEAR = 2026;

const CHILD_A = { ageAtYearEnd: 9, hasSsn: true, monthsLivedWithYou: 12 };
const CHILD_B = { ageAtYearEnd: 4, hasSsn: false, monthsLivedWithYou: 6 };

describe.runIf(url)("the household record keeps up and lets go", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `tax-facts-keep-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  const told = (userId: string, key: string, value: string | number | boolean) =>
    client.janePreference.upsert({
      where: { userId_kind_key: { userId, kind: "fact", key: `profile:${key}` } },
      create: {
        userId,
        kind: "fact",
        key: `profile:${key}`,
        value: { value },
        label: key,
        createdAt: new Date("2026-09-09T19:00:00Z"),
      },
      update: { value: { value } },
    });
  const untell = (userId: string, key: string) =>
    client.janePreference.deleteMany({ where: { userId, key: `profile:${key}` } });
  const rowsOf = (userId: string, key: string) =>
    client.taxFact.findMany({ where: { userId, key }, orderBy: { recordedAt: "asc" } });
  const load = (id: string, year = YEAR) => loadTaxHousehold(id, year, { client, now: NOW });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  describe("an older save never undoes a newer one", () => {
    it("leaves the newer answer current when the two arrive in the wrong order", async () => {
      const id = await person();
      const earlier = new Date("2026-11-27T17:00:00Z");
      const later = new Date("2026-11-27T17:00:05Z");
      const save = (value: string, now: Date) =>
        recordTaxFact(
          id,
          { key: "filing.status", value, taxYear: YEAR, origin: "answer" },
          { client, now },
        );
      // The later save lands first, the earlier one second.
      expect(await save("married_joint", later)).toBe("recorded");
      expect(await save("single", earlier)).toBe("stale");
      const rows = await rowsOf(id, "filing.status");
      expect(rows.map((r) => [r.value, r.supersededAt])).toEqual([[{ v: "married_joint" }, null]]);
      // The other order: the older answer is history, the newer current.
      const other = await person();
      const saveOther = (value: string, now: Date) =>
        recordTaxFact(
          other,
          { key: "filing.status", value, taxYear: YEAR, origin: "answer" },
          { client, now },
        );
      await saveOther("single", earlier);
      await saveOther("married_joint", later);
      const both = await rowsOf(other, "filing.status");
      expect(both.filter((r) => r.supersededAt === null).map((r) => r.value)).toEqual([
        { v: "married_joint" },
      ]);
      expect(both).toHaveLength(2);
    });
  });

  describe("a write that did not land is copied again", () => {
    it("brings the record back in line with the older stores once it is marked", async () => {
      const id = await person();
      await told(id, "tax_residency", "citizen");
      await told(id, "home_state", "CA");
      expect(fact(await load(id), "residency.status").value).toBe("citizen_or_green_card");
      // The older store changes and the write to the record fails (nothing records it).
      await told(id, "tax_residency", "student_visa");
      await untell(id, "home_state");
      // Nothing marked: the record still says what it said.
      expect(fact(await load(id), "residency.status").value).toBe("citizen_or_green_card");
      await markNeedsRepair(id, { client });
      const h = await load(id);
      expect(fact(h, "residency.status").value).toBe("student_visa");
      // What the store no longer says is gone, not kept.
      expect(fact(h, "home.state").status).toBe("unknown");
      expect(await rowsOf(id, "home.state")).toEqual([]);
      // Copying again is the same: nothing new on a third read, one current row, one marker.
      const before = await client.taxFact.count({ where: { userId: id } });
      await load(id);
      expect(await client.taxFact.count({ where: { userId: id } })).toBe(before);
      await markNeedsRepair(id, { client });
      await load(id);
      const residency = await rowsOf(id, "residency.status");
      expect(residency.filter((r) => r.supersededAt === null)).toHaveLength(1);
      const marker = await rowsOf(id, "household.legacy_done");
      expect(marker.filter((r) => r.supersededAt === null).map((r) => r.value)).toEqual([
        { v: true },
      ]);
    });

    it("does not touch a fact the record holds that no older store ever had", async () => {
      const id = await person();
      await recordTaxFact(
        id,
        { key: "prior.agi", value: 9_000_000, taxYear: YEAR, origin: "document" },
        { client, now: NOW },
      );
      await recordTaxFact(
        id,
        { key: "residency.status", value: "student_visa", taxYear: YEAR, origin: "answer" },
        { client, now: NOW },
      );
      // The first copy only adds: a fact written before it stays.
      const h = await load(id);
      expect(fact(h, "residency.status").value).toBe("student_visa");
      expect(fact(h, "prior.agi").value).toBe(9_000_000);
      // A second copy follows the older stores for what they own, and leaves the document fact.
      await markNeedsRepair(id, { client });
      const again = await load(id);
      expect(fact(again, "residency.status").status).toBe("unknown");
      expect(fact(again, "prior.agi").value).toBe(9_000_000);
    });
  });

  describe("a child keeps their own facts when another is removed", () => {
    const familyOf = async (id: string) =>
      (await client.taxProfile.findFirstOrThrow({ where: { userId: id } })).familyChildren as {
        id?: string;
        ageAtYearEnd: number;
      }[];

    it("writes an id for each child once, keys the member by it, and never renumbers", async () => {
      const id = await person();
      await client.taxProfile.create({
        data: {
          userId: id,
          childrenUnder17: 2,
          answered: ["dependants"],
          familyChildren: [CHILD_A, CHILD_B],
        },
      });
      const first = await load(id);
      const [a, b] = await familyOf(id);
      expect(a.id).toMatch(/^c_[0-9a-f]{12}$/);
      expect(b.id).toMatch(/^c_[0-9a-f]{12}$/);
      expect(a.id).not.toBe(b.id);
      expect(first.members.map((m) => m.key)).toEqual([`child:${a.id}`, `child:${b.id}`]);
      expect(fact(first, "member.birth_date", `child:${a.id}`).value).toBe("2017");
      expect(fact(first, "member.birth_date", `child:${b.id}`).value).toBe("2022");
      // Reading again writes no new ids.
      await load(id);
      expect((await familyOf(id)).map((c) => c.id)).toEqual([a.id, b.id]);

      // The first child is removed on the family form: the second keeps its id and its facts.
      await client.taxProfile.update({
        where: { userId: id },
        data: { childrenUnder17: 1, familyChildren: [{ ...CHILD_B, id: b.id }] },
      });
      await markNeedsRepair(id, { client });
      const after = await load(id);
      expect(after.members.map((m) => m.key)).toEqual([`child:${b.id}`]);
      expect(fact(after, "member.birth_date", `child:${b.id}`).value).toBe("2022");
      expect(fact(after, "member.ssn_valid_for_work", `child:${b.id}`).value).toBe("no");
      // The removed child is marked removed (never deleted, never renumbered) and what was said
      // about them is gone.
      const removed = await client.taxHouseholdMember.findFirstOrThrow({
        where: { userId: id, memberKey: `child:${a.id}` },
      });
      expect(removed.removedAt).not.toBeNull();
      expect(fact(after, "member.birth_date", `child:${a.id}`).status).toBe("unknown");
      expect(
        await client.taxFact.count({ where: { userId: id, memberKey: `child:${a.id}` } }),
      ).toBe(0);
      expect(await client.taxHouseholdMember.count({ where: { userId: id } })).toBe(2);
    });
  });

  describe("a forgotten answer is gone from every row", () => {
    it("removes the current, superseded and copied rows of the key, in every year", async () => {
      const id = await person();
      // Two disagreeing answers (a legacy conflict row), one changed answer (a superseded row), two
      // years, and a document row that is not the person's word.
      await told(id, "tax_residency", "citizen");
      await load(id);
      await load(id, YEAR + 1);
      for (const [value, at] of [
        ["student_visa", "2026-11-27T19:00:00Z"],
        ["other_visa", "2026-11-27T20:00:00Z"],
      ] as const)
        await recordTaxFact(
          id,
          { key: "residency.status", value, taxYear: YEAR, origin: "answer" },
          { client, now: new Date(at) },
        );
      await recordTaxFact(
        id,
        { key: "residency.status", value: "unsure", taxYear: YEAR, origin: "legacy" },
        { client, now: NOW },
      );
      await recordTaxFact(
        id,
        {
          key: "residency.status",
          value: "citizen_or_green_card",
          taxYear: YEAR,
          origin: "document",
        },
        { client, now: NOW },
      );
      const before = await rowsOf(id, "residency.status");
      expect(before.filter((r) => r.supersededAt !== null).length).toBeGreaterThan(0);
      expect(before.some((r) => r.origin === "legacy")).toBe(true);

      await untell(id, "tax_residency");
      await forgetTaxFacts(id, { keys: ["residency.status"] }, { client });
      const after = await rowsOf(id, "residency.status");
      // Only the document row is left: it is read again from its source, not the person's word.
      expect(after.map((r) => r.origin)).toEqual(["document"]);
      await client.taxFact.deleteMany({ where: { userId: id, key: "residency.status" } });
      expect(fact(await load(id), "residency.status").status).toBe("unknown");
      expect(fact(await load(id, YEAR + 1), "residency.status").status).toBe("unknown");
      expect(await client.taxFact.count({ where: { userId: id, key: "residency.status" } })).toBe(
        0,
      );
    });

    it("goes with the account", async () => {
      const id = await person();
      await told(id, "tax_residency", "citizen");
      await load(id);
      expect(await client.taxFact.count({ where: { userId: id } })).toBeGreaterThan(0);
      await client.taxHouseholdMember.create({
        data: {
          userId: id,
          taxYear: YEAR,
          memberKey: "child:count-1",
          label: "Child 1",
          relationship: "child",
        },
      });
      await client.user.delete({ where: { id } });
      expect(await client.taxFact.count({ where: { userId: id } })).toBe(0);
      expect(await client.taxHouseholdMember.count({ where: { userId: id } })).toBe(0);
    });
  });
});
