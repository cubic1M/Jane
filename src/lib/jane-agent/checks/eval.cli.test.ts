import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { PersonId } from "@/config/people";
import { loadFacts, type Facts } from "./facts";
import { createCheckPerson, deleteCheckPerson } from "./person";
import { runAnswerChecks } from "./run";
import {
  addToState,
  batchOf,
  emptyState,
  evalSection,
  filesOf,
  parseScenarioFiles,
  parseState,
  quotaOrder,
  reportByCategory,
  scenarioQuestions,
  withEvalSection,
} from "./scenarios";

// `npm run checks:eval`, run by .github/workflows/chat-eval.yml: the scenarios in
// CHAT_EVAL_FILE (default docs/chat-scenarios.json) asked as the demo-bank person would, in
// batches: CHAT_EVAL_FROM..CHAT_EVAL_TO (positions in the file, 1-based), each batch within
// CHAT_EVAL_MAX_CENTS (default 400). Finished scenarios are kept in docs/chat-eval-state.json,
// and with CHAT_EVAL_RESUME=1 they are not asked again, so the next batch picks up where the
// last stopped. Needs ANTHROPIC_API_KEY. The per-category pass rates and the 20 worst answers
// go into the "Scenario run" section of docs/chat-quality.md. Skipped in `npm test`.

const url = process.env.TEST_DATABASE_URL;
const FILE = process.env.CHAT_EVAL_FILE || "docs/chat-scenarios*.json";
const DOC = "docs/chat-quality.md";
const STATE = "docs/chat-eval-state.json";
const num = (v: string | undefined) => (v && Number(v) > 0 ? Number(v) : undefined);
const CAP_CENTS = Number(process.env.CHAT_EVAL_MAX_CENTS ?? 400);

it.runIf(process.env.CHAT_EVAL === "1" && url && process.env.ANTHROPIC_API_KEY)(
  "runs the scenarios",
  async () => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    }
    const files = filesOf(FILE, (dir) => readdirSync(dir));
    expect(files.length, `no scenario files match ${FILE}`).toBeGreaterThan(0);
    // One fixed shuffle over all the files, so positions mean the same in every batch.
    const parsed = parseScenarioFiles(files.map((f) => readFileSync(f, "utf8")));
    const scenarios = quotaOrder(parsed.scenarios);
    const resume = process.env.CHAT_EVAL_RESUME === "1" && existsSync(STATE);
    const before = resume ? parseState(readFileSync(STATE, "utf8")) : emptyState();
    const batch = batchOf(scenarios, {
      from: num(process.env.CHAT_EVAL_FROM),
      to: num(process.env.CHAT_EVAL_TO),
      state: before,
    });
    console.log(
      `${batch.length} scenarios to ask (${Object.keys(before.done).length} already done).`,
    );
    if (batch.length === 0) return;
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const now = new Date();
    // Each sample person the batch asks as, made once.
    const people = new Map<string, { userId: string; facts: Facts }>();
    try {
      for (const key of new Set(batch.map((s) => s.person ?? "default"))) {
        const userId = await createCheckPerson({
          client,
          now,
          person: key === "default" ? undefined : (key as PersonId),
        });
        people.set(key, { userId, facts: await loadFacts(userId, { client, now }) });
      }
      const [first] = [...people.values()];
      const run = await runAnswerChecks(first.userId, {
        client,
        now,
        capCents: CAP_CENTS,
        questions: scenarioQuestions(batch),
        facts: first.facts,
        personFor: (lead) => people.get(lead.person ?? "default")!,
      });
      const state = addToState(before, batch, run.results, run.costCents);
      writeFileSync(STATE, `${JSON.stringify(state)}\n`);
      const finished = scenarios.filter((s) => state.done[s.id]);
      const reports = reportByCategory(
        { results: finished.flatMap((s) => state.done[s.id]) },
        scenarios,
      );
      const section = evalSection(reports, {
        date: now.toISOString().slice(0, 10),
        scenarios: finished.length,
        costCents: state.costCents,
        capCents: CAP_CENTS,
        stoppedAtCap: run.stoppedAtCap,
        invalid: parsed.skipped,
      });
      writeFileSync(DOC, withEvalSection(readFileSync(DOC, "utf8"), section));
      console.log(section);
      expect(run.graded).toBeGreaterThan(0);
    } finally {
      for (const { userId } of people.values()) await deleteCheckPerson(userId, { client });
      await client.$disconnect();
    }
  },
  5 * 60 * 60 * 1000,
);
