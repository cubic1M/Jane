import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PERSON_IDS } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadProfileInput } from "@/lib/profile";
import { loadTaxHousehold } from "@/lib/tax-facts/load";
import { loadWorkingProfile, saveTaxAnswers } from "@/lib/tax-profile";
import { fact } from "@/planning/tax-engine/facts";

// Step T9's "done when": for every sample person the household record says the same filing status,
// number of dependants and state as the working tax profile, which the Taxes page and the chat read.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const YEAR = 2026;

describe.runIf(url)("the household record and the working profile, for every sample person", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  for (const personId of PERSON_IDS) {
    it(`agrees for ${personId}, whether Jane may use what it found or not`, async () => {
      const user = await client.user.create({
        data: { email: `tax-sample-${personId}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED, person: personId });
      await syncItem(itemId, { client, api: plaid, now: LINKED });

      for (const level of ["ask", "safe"] as const) {
        if (level === "safe") await setAutopilot(user.id, "safe", { client, now: LINKED });
        const { profile } = await loadWorkingProfile(user.id, { client, now: LINKED });
        const h = await loadTaxHousehold(user.id, YEAR, { client, now: LINKED });
        // What the person said counts always; what Jane found counts only at the level that uses it.
        const counts = (f: { status: string }) =>
          f.status === "known" || (level === "safe" && f.status === "inferred");

        const filing = fact<string>(h, "filing.status");
        expect(filing.value, `${personId} filing status`).toBe(profile.filingStatus);

        const state = fact<string>(h, "home.state");
        expect(counts(state) ? state.value : null, `${personId} state`).toBe(profile.state);

        const stated = fact(h, "household.dependants_stated").status === "known";
        const members = stated || level === "safe" ? h.members.length : 0;
        expect(members, `${personId} dependants`).toBe(
          profile.childrenUnder17 + profile.otherDependants,
        );

        // A sample person leaves nothing of the record behind, and is a made-up citizen.
        expect(await client.taxFact.count({ where: { userId: user.id } })).toBe(0);
        expect(fact(h, "residency.status").value).toBe("citizen_or_green_card");
      }

      // And once they answer the state, both say it, as their answer.
      await saveTaxAnswers(user.id, [{ field: "state", value: "OR" }], {
        client,
        now: LINKED,
        via: "page",
      });
      const answered = await loadWorkingProfile(user.id, { client, now: LINKED });
      const home = fact<string>(
        await loadTaxHousehold(user.id, YEAR, { client, now: LINKED }),
        "home.state",
      );
      expect(answered.profile.state).toBe("OR");
      expect(home).toMatchObject({ value: "OR", status: "known", origin: "answer" });

      // The profile a detector reads carries the household for the year being worked on.
      const input = await loadProfileInput(user.id, { client, now: LINKED });
      expect(Object.keys(input.taxHouseholds ?? {})).toEqual([String(YEAR)]);
    }, 240_000);
  }
});
