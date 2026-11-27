import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { runTaxTool } from "@/lib/jane-agent/tax-tools-run";
import { formatCents } from "@/lib/money";
import { correctFact } from "@/lib/profile";
import { detectFor } from "@/lib/suggestions";
import { loadTaxEstimate } from "./tax-estimate";
import { loadToldResidency } from "./tax-residency";

// The earned income credit is for US citizens and residents (IRS Pub. 519): the estimate on the
// Taxes page, the card and the chat all hold it back until the person says they are a citizen or
// green card holder, and agree on what they say. A sample person comes with that told (a made-up US
// citizen); the other answers are made here.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");

describe.runIf(url)(
  "the earned income credit and the person's status",
  { timeout: 300_000 },
  () => {
    let client: PrismaClient;
    let id: string;

    const forget = () =>
      client.janePreference.deleteMany({
        where: { userId: id, kind: "fact", key: "profile:tax_residency" },
      });
    const view = () => loadTaxEstimate(id, { client, now: NOW });
    // Several tests read the same person in different states: nothing is kept between them.
    const say = async (value: string | null) => {
      if (value === null) await forget();
      else await correctFact(id, "tax_residency", value, { client, now: NOW });
    };
    const eitcLines = (assumptions: string[]) =>
      assumptions.filter((a) => a.startsWith("I haven't counted the Earned Income Credit"));

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
      // An account of their own beside the demo bank: not a sample person, so nothing is told yet.
      id = await createCheckPerson({ client, now: NOW, person: "debt", ownAccount: true });
      // About $10,000 of pay so far: low enough for the credit, and age 27 is inside 25 to 64.
      await client.taxCorrection.create({
        data: { userId: id, year: 2026, kind: "wages", label: "Pay", cents: 1_000_000 },
      });
    });

    afterAll(async () => {
      await deleteCheckPerson(id, { client }).catch(() => {});
      await client.$disconnect();
    });

    it("is counted for a person who said so, and a sample person comes as a citizen without anything stored", async () => {
      // A sample person (the demo bank's made-up life) and the original demo bank are citizens as
      // the loaders read them; the demo bank leaves no trace, so nothing is stored for it.
      for (const person of ["debt", undefined] as const) {
        const other = await createCheckPerson({ client, now: NOW, ...(person ? { person } : {}) });
        try {
          expect(await loadToldResidency(other, { client }), String(person)).toEqual({
            kind: "citizen",
            allowed: true,
          });
          expect(
            await client.janePreference.count({
              where: { userId: other, key: "profile:tax_residency" },
            }),
          ).toBe(0);
        } finally {
          await deleteCheckPerson(other, { client }).catch(() => {});
        }
      }
      // Someone with an account of their own is not asked for nothing: unknown until they say.
      expect(await loadToldResidency(id, { client })).toEqual({ kind: "unknown", allowed: false });
      await say("citizen");
      expect((await loadToldResidency(id, { client })).allowed).toBe(true);
      const v = await view();
      expect(v.estimate.credits.earnedIncomeCreditCents).toBeGreaterThan(0);
      expect(eitcLines(v.assumptions)).toEqual([]);
    });

    it("is left out, with the line that says why and asks, until they have said", async () => {
      await say("citizen");
      const open = (await view()).estimate;
      const credit = open.credits.earnedIncomeCreditCents;
      expect(credit).toBeGreaterThan(0);

      await say(null);
      const held = await view();
      expect((await loadToldResidency(id, { client })).kind).toBe("unknown");
      expect(held.estimate.credits.earnedIncomeCreditCents).toBe(0);
      // The credit's dollars go back into the tax and out of the refund, nothing else moves.
      expect(held.estimate.totalTaxCents).toBe(open.totalTaxCents + credit);
      expect(held.estimate.refundCents).toBe(open.refundCents - credit);
      expect(held.estimate.agiCents).toBe(open.agiCents);
      const [line] = eitcLines(held.assumptions);
      expect(eitcLines(held.assumptions)).toHaveLength(1);
      expect(line).toContain("it depends on whether you're a US citizen or resident for tax");
      expect(line).toContain("Tell me and I'll check it.");
      expect(line).toContain(`(up to ${formatCents(credit)})`);
    });

    it("is left out and explained for a student visa and another visa, with no question to answer", async () => {
      for (const [said, words] of [
        ["student_visa", "F-1 and J-1 students are usually nonresident"],
        ["other_visa", "depends on your days in the US"],
        ["unsure", "I don't have yet"],
      ] as const) {
        await say(said);
        const v = await view();
        expect(v.estimate.credits.earnedIncomeCreditCents, said).toBe(0);
        const [line] = eitcLines(v.assumptions);
        expect(line, said).toContain(words);
        if (said !== "unsure") expect(line, said).not.toContain("Tell me");
      }
    });

    it("is the same on the page, the card and the chat, whatever they said", async () => {
      for (const said of [null, "unsure", "student_visa", "other_visa", "citizen"] as const) {
        await say(said);
        const v = await view();
        const credit = v.estimate.credits.earnedIncomeCreditCents;
        // The page's figure is the chat's: its credits line and its assumptions.
        const tool = JSON.parse(
          (await runTaxTool(id, "tax_estimate", {}, { client, now: NOW })).content,
        ) as { federal?: { credits: string }; assumptions?: string[] };
        const c = v.estimate.credits;
        expect(tool.assumptions ?? [], String(said)).toEqual(v.assumptions);
        expect(tool.federal?.credits, String(said)).toBe(
          formatCents(
            c.childTaxCreditCents +
              c.otherDependantCreditCents +
              c.additionalChildTaxCreditCents +
              c.earnedIncomeCreditCents,
          ),
        );
        // The card: held exactly when the page leaves the credit out.
        const topics = (await detectFor(id, { client, now: NOW })).suggestions.map((s) => s.topic);
        if (said !== "citizen") {
          expect(credit, String(said)).toBe(0);
          expect(topics, String(said)).not.toContain("earned_income_credit");
          expect(topics, String(said)).not.toContain("education_credit");
        } else {
          expect(credit).toBeGreaterThan(0);
        }
      }
    });
  },
);
