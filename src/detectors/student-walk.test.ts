import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import {
  STUDENT_SHAPES,
  STUDENT_TODAY,
  inputFromStatements,
  suggestionsOf,
} from "./__fixtures__/student-walk";

// The tax suggestions a student gets from one uploaded statement (suggest-taxes, 11-18): the walk's
// shapes and the Stanford students', each the tax topics it must get and must never get. With
// MEASURE_OUT set, it also writes the table the suggest-taxes notes open with (every person, all
// suggestions and the tax ones).

const WALK: Record<string, string[]> = {
  "walk-checking-only": ["e2e/fixtures/messy/checking.csv"],
  "walk-one-month": ["src/data-sources/csv/__fixtures__/chase-checking.csv"],
  "walk-old-statement": ["src/data-sources/csv/__fixtures__/bofa-checking.csv"],
};

// Each shape's tax topics, today. A new tax detector that reaches one of them adds it here.
const EXPECTED: Record<string, { must: string[]; never: string[] }> = {
  "walk-checking-only": { must: [], never: ["stipend_tax", "student_tax_residency"] },
  "walk-one-month": { must: [], never: ["stipend_tax", "student_tax_residency"] },
  "walk-old-statement": { must: [], never: ["stipend_tax", "student_tax_residency"] },
  "fellowship-one-month": { must: ["stipend_tax"], never: ["student_tax_residency"] },
  "fellowship-two-months": { must: ["stipend_tax"], never: ["student_tax_residency"] },
  "undergrad-one-month": { must: [], never: ["stipend_tax"] },
  // Student-loan payments and rent off campus in California; the education credit waits on tuition.
  "gig-two-months": {
    must: ["student_loan_interest", "ca_renters_credit"],
    never: ["stipend_tax", "education_credit"],
  },
  // On campus: no renter's credit.
  "ra-two-months": { must: [], never: ["stipend_tax", "ca_renters_credit"] },
};

const filesOf = (paths: string[]) =>
  paths.map((p) => ({ name: p.split("/").pop()!, text: readFileSync(p, "utf8") }));

async function shapes() {
  const out: { name: string; topics: string[]; all: number }[] = [];
  const add = (name: string, fired: { capability: string; topic: string }[]) =>
    out.push({
      name,
      all: fired.length,
      topics: fired.filter((s) => s.capability === "taxes").map((s) => s.topic),
    });
  for (const [name, paths] of Object.entries(WALK))
    add(name, suggestionsOf(await inputFromStatements(filesOf(paths), STUDENT_TODAY)));
  for (const [name, files] of Object.entries(STUDENT_SHAPES))
    add(name, suggestionsOf(await inputFromStatements(files(), STUDENT_TODAY)));
  return out;
}

describe("a student's tax suggestions from one uploaded statement", () => {
  it("gets what each shape must, and nothing it must not", async () => {
    for (const shape of await shapes()) {
      const want = EXPECTED[shape.name];
      for (const topic of want.must) expect(shape.topics, shape.name).toContain(topic);
      for (const topic of want.never) expect(shape.topics, shape.name).not.toContain(topic);
    }
  });

  it("writes the table when asked", async () => {
    const out = process.env.MEASURE_OUT;
    if (!out) return;
    const rows = await shapes();
    for (const person of PEOPLE) {
      const data = inputFor(person.id);
      const fired = runDetectors({ profile: buildProfile(data), data });
      rows.push({
        name: person.id,
        all: fired.length,
        topics: fired.filter((s) => s.capability === "taxes").map((s) => s.topic),
      });
    }
    writeFileSync(
      out,
      [
        "| Person | All suggestions | Tax | Tax topics |",
        "| --- | --- | --- | --- |",
        ...rows.map(
          (r) => `| ${r.name} | ${r.all} | ${r.topics.length} | ${r.topics.join(", ")} |`,
        ),
      ].join("\n"),
    );
  });
});
