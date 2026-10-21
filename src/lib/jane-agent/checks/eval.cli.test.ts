import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { createCheckPerson, deleteCheckPerson } from "./person";
import { runAnswerChecks } from "./run";
import {
  evalSection,
  parseScenarios,
  reportByCategory,
  scenarioQuestions,
  withEvalSection,
} from "./scenarios";

// `npm run checks:eval`, run by .github/workflows/chat-eval.yml: the scenarios in
// CHAT_EVAL_FILE (default docs/chat-scenarios.json) asked as the demo-bank person would, all of
// them (no rotation), within CHAT_EVAL_MAX_CENTS (default 400). Needs ANTHROPIC_API_KEY. The
// per-category failures go into the "Scenario run" section of docs/chat-quality.md. Skipped in
// `npm test`.

const url = process.env.TEST_DATABASE_URL;
const FILE = process.env.CHAT_EVAL_FILE ?? "docs/chat-scenarios.json";
const DOC = "docs/chat-quality.md";
const CAP_CENTS = Number(process.env.CHAT_EVAL_MAX_CENTS ?? 400);

it.runIf(process.env.CHAT_EVAL === "1" && url && process.env.ANTHROPIC_API_KEY)(
  "runs the scenarios",
  async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    }
    const scenarios = parseScenarios(readFileSync(FILE, "utf8"));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const now = new Date();
    const userId = await createCheckPerson({ client, now });
    try {
      const run = await runAnswerChecks(userId, {
        client,
        now,
        capCents: CAP_CENTS,
        questions: scenarioQuestions(scenarios),
      });
      const reports = reportByCategory(run, scenarios);
      const section = evalSection(reports, {
        date: now.toISOString().slice(0, 10),
        scenarios: scenarios.length,
        costCents: run.costCents,
        capCents: CAP_CENTS,
        stoppedAtCap: run.stoppedAtCap,
      });
      writeFileSync(DOC, withEvalSection(readFileSync(DOC, "utf8"), section));
      console.log(section);
      expect(run.graded).toBeGreaterThan(0);
    } finally {
      await deleteCheckPerson(userId, { client });
      await client.$disconnect();
    }
  },
  5 * 60 * 60 * 1000,
);
