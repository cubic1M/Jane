import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every act a card or the chat offers goes through the one planner and its gate (./pipeline.ts):
// a "yes" reaches connectors only through recordDecision and ./for-card.ts. Nothing outside
// src/lib/connectors plans, acts or opens a grant on its own.

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "generated" || e.name === "__fixtures__"
        ? []
        : files(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

describe("acts through connectors", () => {
  const outside = files("src").filter((f) => !f.startsWith(join("src", "lib", "connectors")));

  it("are planned only through the pipeline, from recordDecision", () => {
    const planners = outside.filter((f) => /\bplanAction\s*\(/.test(readFileSync(f, "utf8")));
    // src/app/taxes/actions.ts has a form action of its own by that name, not the pipeline's.
    expect(
      planners.filter((f) => /from "@\/lib\/connectors\/pipeline"/.test(readFileSync(f, "utf8"))),
    ).toEqual([]);
    const viaCards = outside.filter((f) => /\bplanForCard\s*\(/.test(readFileSync(f, "utf8")));
    expect(viaCards).toEqual([join("src", "lib", "decisions.ts")]);
  });

  it("never act or open a grant outside src/lib/connectors", () => {
    for (const file of outside) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bwithGrant\s*\(/);
      // The jobs queue runs a plan once its hold is over: the pipeline's own step.
      if (file !== join("src", "lib", "jobs.ts"))
        expect(text, file).not.toMatch(/\bexecuteAction\s*\(/);
      expect(text, file).not.toMatch(/from "@\/lib\/connectors\/(?:gate|sandbox\/adapters)"/);
    }
  });
});
