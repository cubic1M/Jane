import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { RULES_SCORE_FLOOR } from "@/config/answer-checks";
import { QUESTIONS, type CheckQuestion } from "./bank";
import { createCheckPerson, deleteCheckPerson } from "./person";
import { AT_CAP, NO_KEY, runAnswerChecks } from "./run";
import { compareRuns, formatRun, previousRun, saveRun } from "./store";

// Spec step 87 against a real, migrated Postgres: the rules questions run over the demo bank
// with no Anthropic key (as in CI), every question gets a grade or a reason it was skipped,
// runs are saved and compared, and a run with Claude (a fake here) stops at its cap.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles.
const NOW = new Date("2026-10-18T15:00:00Z");

// A fake Claude: every chat answer is the same text, and costs what `usage` says; the
// grader always gives 4 and 5.
function fakeClaude(text: string, usage: { input_tokens: number; output_tokens: number }) {
  const message = { stop_reason: "end_turn", content: [{ type: "text", text }], usage };
  return () =>
    ({
      messages: {
        stream: () => {
          const stream = {
            on: () => stream,
            finalMessage: async () => message,
          };
          return stream;
        },
        create: async () => ({
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"usefulness":4,"tone":5,"reason":"Clear."}' }],
          usage: { input_tokens: 1_000, output_tokens: 100 },
        }),
      },
    }) as never;
}

describe.runIf(url)("Jane's answer checks against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await client.answerCheckRun.deleteMany({ where: { promptVersion: { startsWith: "test-" } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("runs the rules questions without a key, grading each and skipping the rest", async () => {
    const run = await runAnswerChecks(userId, { client, now: NOW });
    expect(run.mode).toBe("rules_only");
    expect(run.claudeGrading).toMatch(/^Skipped/);
    expect(run.results.map((r) => r.id).sort()).toEqual(QUESTIONS.map((q) => q.id).sort());
    for (const r of run.results) {
      expect(r.reason, r.id).not.toBe("");
      if (r.needs === "rules") {
        expect(r.status, r.id).toBe("graded");
        expect(r.score, r.id).toBeGreaterThanOrEqual(0);
        expect(r.score, r.id).toBeLessThanOrEqual(100);
        expect(r.firstWordsMs, r.id).toBeGreaterThanOrEqual(0);
      } else {
        expect(r.status, r.id).toBe("skipped");
      }
    }
    expect(run.results.filter((r) => r.needs === "claude" && !r.after)[0].reason).toBe(NO_KEY);
    expect(run.costCents).toBe(0);
    // The chat must never get worse than its last agreed score.
    expect(run.score).toBeGreaterThanOrEqual(RULES_SCORE_FLOOR);
    console.log(formatRun(run));

    // Saved, and comparable with the next run.
    const saved = await saveRun({ ...run, promptVersion: "test-a" }, { client });
    const before = await previousRun(
      { client },
      "rules_only",
      new Date(saved.createdAt.getTime() + 1),
    );
    expect(before?.score).toBe(run.score);
    const comparison = compareRuns(before!, { ...run, score: (run.score ?? 0) + 1 });
    expect(comparison.scoreChange).toBe(1);
    expect(comparison.changed).toEqual([]);
  }, 120_000);

  it("with Claude, grades by the rubric too and stops at its spending cap", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    try {
      const questions: CheckQuestion[] = [
        { id: "a", text: "is Netflix worth it", needs: "claude", expect: {} },
        { id: "b", text: "safe to spend", needs: "rules", expect: {} },
        { id: "c", text: "is Hulu worth it", needs: "claude", expect: {} },
      ];
      // Each chat answer costs a million input tokens: $2.00 on the chat model.
      const claude = fakeClaude("Netflix is $17.99 a month.", {
        input_tokens: 1_000_000,
        output_tokens: 0,
      });

      const roomy = await runAnswerChecks(userId, {
        client,
        now: NOW,
        questions,
        claude,
        capCents: 10_000,
      });
      expect(roomy.mode).toBe("full");
      expect(roomy.claudeGrading).toBe("used");
      expect(roomy.stoppedAtCap).toBe(false);
      const a = roomy.results.find((r) => r.id === "a")!;
      expect(a).toMatchObject({
        status: "graded",
        source: "claude",
        claude: { usefulness: 4, tone: 5 },
      });
      expect(a.reason).toContain("Claude: Clear.");
      expect(roomy.costCents).toBeGreaterThan(400);

      const capped = await runAnswerChecks(userId, {
        client,
        now: NOW,
        questions,
        claude,
        capCents: 100,
      });
      expect(capped.stoppedAtCap).toBe(true);
      expect(capped.results.map((r) => r.status)).toEqual(["graded", "skipped", "skipped"]);
      expect(capped.results[0].reason).toContain("reached its cap");
      expect(capped.results[1].reason).toBe(AT_CAP);
    } finally {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
    }
  }, 120_000);
});
