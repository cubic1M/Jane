// Jane's answer checks (spec step 87): a bank of real questions over the demo bank, each
// graded by fixed checks and, with an Anthropic key, by Claude against a written rubric.
// src/lib/jane-agent/checks reads every limit from here.

// The longest a good answer is, in characters, unless a question says otherwise.
export const ANSWER_MAX_CHARS = 700;
// The first sentence carries the answer (spec step 89), so it stays short.
export const ANSWER_FIRST_SENTENCE_MAX = 200;

// What one run may spend on Claude (Jane's free answers and the grader together), in
// cents. The run stops asking once it's reached, and says so.
export const ANSWER_CHECK_CAP_CENTS = 300;

// Claude's prices, in cents per million tokens (input, output), for the spending cap. A
// model not listed counts at the most expensive price here, so the cap never undercounts.
export const MODEL_PRICES_CENTS: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-haiku-5-5": { input: 10, output: 50 },
  "claude-sonnet-5-5": { input: 200, output: 1_000 },
  "claude-opus-5-5": { input: 400, output: 2_000 },
  "claude-fable-5-1": { input: 1_000, output: 5_000 },
};

// With Claude's grade, a question's score is this share fixed checks, the rest the grade.
export const FIXED_CHECKS_SHARE = 0.6;

// The rules-only questions run in CI (src/lib/jane-agent/checks/checks.integration.test.ts)
// and must score at least this overall: raised as the chat gets better, never lowered.
export const RULES_SCORE_FLOOR = 80;
