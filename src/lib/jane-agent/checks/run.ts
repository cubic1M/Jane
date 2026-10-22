import type Anthropic from "@anthropic-ai/sdk";
import {
  ANSWER_CHECK_CAP_CENTS,
  FIXED_CHECKS_SHARE,
  MODEL_PRICES_CENTS,
} from "@/config/answer-checks";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic, llmEnabled } from "@/lib/anthropic";
import { scopedFor } from "@/lib/db-scoped";
import { CHAT_PROMPT_VERSION } from "../claude";
import { sendToJane, type AnswerSource } from "../typing";
import { QUESTIONS, type CheckQuestion } from "./bank";
import { loadFacts, type Facts } from "./facts";
import { fixedChecks, fixedScore, reasonOf, type Check } from "./grade";
import { GRADER_VERSION, gradeWithClaude, type ClaudeGrade, type Usage } from "./grader";

// Runs Jane's answer checks (spec step 87) for one demo-bank person: asks each question in
// the chat as the person would (follow-ups right after their first question, each
// conversation started fresh), times Jane's first words, and grades the answer: fixed
// checks first, then Claude against the rubric. Without an Anthropic key only the rules
// questions run, with the fixed checks, and the rest is reported as skipped. With one, the
// run stops asking once it has spent its cap.

export type QuestionResult = {
  id: string;
  text: string;
  needs: CheckQuestion["needs"];
  after?: string;
  status: "graded" | "skipped";
  // Why it was skipped, or what to fix.
  reason: string;
  score?: number;
  answer?: string;
  buttons?: string[];
  source?: AnswerSource;
  firstWordsMs?: number;
  // Until the whole answer was there (for a rules answer, the same as the first words).
  totalMs?: number;
  // A follow-up to an earlier question, or two questions in one message.
  followUp?: boolean;
  checks?: Check[];
  claude?: ClaudeGrade;
  // Spec step 93: the guardrail rules that blocked Claude's answer, if any.
  blockedBy?: string[];
};

export type CheckRun = {
  mode: "rules_only" | "full";
  startedAt: string;
  promptVersion: string;
  graderVersion: string;
  // How Claude's grading went: "used", or why it was skipped.
  claudeGrading: string;
  score: number | null;
  graded: number;
  skipped: number;
  costCents: number;
  capCents: number;
  stoppedAtCap: boolean;
  firstWordsMs: { median: number; max: number } | null;
  // Spec step 93: how many answers each guardrail rule blocked.
  blockedBy: Record<string, number>;
  results: QuestionResult[];
};

type Options = {
  client: PrismaClient;
  now: Date;
  questions?: readonly CheckQuestion[];
  claude?: () => Pick<Anthropic, "messages">;
  capCents?: number;
  // Spec step 195: a rotating share of the Claude questions each night, so the whole bank is
  // covered over a few weeks within a small budget: this many conversations starting at
  // `day` times `count` around the bank. The rules questions always run (they're free).
  rotate?: { day: number; count: number };
  // The person's numbers, when the caller already loaded them (a test running the bank in
  // chunks loads them once).
  facts?: Facts;
  // Scenario runs ask as several sample people: who a conversation is asked as, from its
  // first question. Without it everything is asked as `userId`.
  personFor?: (lead: CheckQuestion) => { userId: string; facts: Facts };
};

export const NO_KEY = "Needs Claude, and there's no ANTHROPIC_API_KEY: skipped.";
export const AT_CAP = "The run reached its spending cap before this one: skipped.";
const LEAD_SKIPPED = "Its first question was skipped, so this follow-up was too.";

// What Claude cost, in cents, at the listed prices (the most expensive for a model not
// listed, so the cap never undercounts).
export function costOf(usage: Usage): number {
  const prices = Object.values(MODEL_PRICES_CENTS);
  const price = MODEL_PRICES_CENTS[usage.model] ?? {
    input: Math.max(...prices.map((p) => p.input)),
    output: Math.max(...prices.map((p) => p.output)),
  };
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

// The questions in asking order: each first question, then its follow-ups.
export function conversations(questions: readonly CheckQuestion[]): CheckQuestion[][] {
  return questions
    .filter((q) => !q.after)
    .map((lead) => [lead, ...questions.filter((q) => q.after === lead.id)]);
}

// The conversations to run: every one that needs only the rules, and a window of those that
// need Claude, moving along the bank each night (spec step 195). Without `rotate`, all.
export function rotated(all: CheckQuestion[][], rotate: Options["rotate"]): CheckQuestion[][] {
  if (!rotate) return all;
  const claude = all.filter((c) => c[0].needs === "claude");
  const start = claude.length === 0 ? 0 : (rotate.day * rotate.count) % claude.length;
  const window = new Set(
    Array.from(
      { length: Math.min(rotate.count, claude.length) },
      (_, i) => claude[(start + i) % claude.length],
    ),
  );
  return all.filter((c) => c[0].needs !== "claude" || window.has(c));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

export async function runAnswerChecks(
  userId: string,
  {
    client,
    now,
    questions = QUESTIONS,
    claude = anthropic,
    capCents = ANSWER_CHECK_CAP_CENTS,
    rotate,
    facts: given,
    personFor,
  }: Options,
): Promise<CheckRun> {
  const full = llmEnabled();
  // The check run has its own spending cap (below); the live chat's monthly guard is not its
  // business, and its spend isn't the live chat's.
  const monthlyBefore = process.env.CHAT_MONTHLY_CAP_CENTS;
  process.env.CHAT_MONTHLY_CAP_CENTS = "1000000000";
  try {
    return await runChecks(
      userId,
      { client, now, questions, claude, capCents, rotate, facts: given, personFor },
      full,
    );
  } finally {
    if (monthlyBefore === undefined) delete process.env.CHAT_MONTHLY_CAP_CENTS;
    else process.env.CHAT_MONTHLY_CAP_CENTS = monthlyBefore;
  }
}

async function runChecks(
  userId: string,
  {
    client,
    now,
    questions = QUESTIONS,
    claude = anthropic,
    capCents = ANSWER_CHECK_CAP_CENTS,
    rotate,
    facts: given,
    personFor,
  }: Options,
  full: boolean,
): Promise<CheckRun> {
  const baseFacts = given ?? (personFor ? null : await loadFacts(userId, { client, now }));
  let spent = 0;
  // Jane's own calls to Claude count toward the cap too.
  const metered = () => {
    const real = claude();
    return {
      messages: {
        ...real.messages,
        stream: ((params: Parameters<Anthropic["messages"]["stream"]>[0]) => {
          const stream = real.messages.stream(params);
          const finalMessage = stream.finalMessage.bind(stream);
          stream.finalMessage = async () => {
            const message = await finalMessage();
            spent += costOf({
              model: params.model,
              inputTokens: message.usage?.input_tokens ?? 0,
              outputTokens: message.usage?.output_tokens ?? 0,
            });
            return message;
          };
          return stream;
        }) as Anthropic["messages"]["stream"],
      },
    } as Pick<Anthropic, "messages">;
  };

  const results: QuestionResult[] = [];
  let stoppedAtCap = false;
  let tick = 0;
  for (const conversation of rotated(conversations(questions), rotate)) {
    // A fresh conversation: no earlier questions, and the chat's hourly limits reset.
    const who = personFor?.(conversation[0]) ?? { userId, facts: baseFacts! };
    const facts = who.facts;
    const db = scopedFor(who.userId, client);
    await db.janeMessages.deleteMany({ where: { kind: { in: ["user", "reply"] } } });
    await client.rateLimit.deleteMany({
      where: {
        key: { in: [`chat:${who.userId}`, `ask:${who.userId}`, `chatspend:${who.userId}`] },
      },
    });
    const earlier: { role: "user" | "assistant"; content: string }[] = [];
    let leadSkipped = false;

    for (const question of conversation) {
      const base = {
        id: question.id,
        text: question.text,
        needs: question.needs,
        after: question.after,
      };
      const skip = (reason: string) => {
        results.push({ ...base, status: "skipped", reason });
        leadSkipped ||= !question.after;
      };
      if (question.after && leadSkipped) {
        skip(LEAD_SKIPPED);
        continue;
      }
      if (question.needs === "claude" && !full) {
        skip(NO_KEY);
        continue;
      }
      if (full && spent >= capCents) {
        stoppedAtCap = true;
        skip(AT_CAP);
        continue;
      }

      const started = performance.now();
      let firstWords: number | null = null;
      const { reply, source, issues } = await sendToJane(who.userId, question.text, {
        client,
        now: new Date(now.getTime() + (tick += 1000)),
        claude: metered,
        // Grading isn't a person waiting: Claude gets all the numbers.
        primerMs: 60_000,
        onEvent: (event) => {
          if (event.type === "text" && firstWords === null) firstWords = performance.now();
        },
      });
      const totalMs = Math.round(performance.now() - started);
      const firstWordsMs = Math.round((firstWords ?? performance.now()) - started);
      const checks = fixedChecks(
        question,
        { body: reply.body, actions: reply.actions, source },
        facts,
        earlier.map((t) => t.content),
      );
      const fixed = fixedScore(checks);
      let grade: ClaudeGrade | undefined;
      let gradeNote = "";
      if (full && spent < capCents) {
        const graded = await gradeWithClaude(
          {
            question: question.text,
            earlier,
            answer: reply.body,
            buttons: reply.actions.map((a) => a.label),
            facts,
            ...(question.judge ? { rules: question.judge } : {}),
          },
          claude,
        );
        if (graded.usage) spent += costOf(graded.usage);
        grade = graded.grade ?? undefined;
        if (!graded.grade) gradeNote = " Claude couldn't grade it.";
      } else if (full) {
        gradeNote = " Claude's grade was skipped: the run reached its cap.";
      }
      results.push({
        ...base,
        status: "graded",
        score: grade
          ? Math.round(FIXED_CHECKS_SHARE * fixed + (1 - FIXED_CHECKS_SHARE) * grade.score)
          : fixed,
        reason: `${reasonOf(checks)}${grade ? ` Claude: ${grade.reason}` : ""}${gradeNote}`,
        answer: reply.body,
        buttons: reply.actions.map((a) => (a.kind === "link" ? `open ${a.href}` : a.id)),
        source,
        firstWordsMs,
        totalMs,
        followUp: Boolean(question.after) || question.sector === "two",
        checks,
        claude: grade,
        ...(issues ? { blockedBy: issues } : {}),
      });
      earlier.push(
        { role: "user", content: question.text },
        { role: "assistant", content: reply.body },
      );
    }
  }

  const graded = results.filter((r) => r.status === "graded");
  const times = graded.map((r) => r.firstWordsMs!);
  return {
    mode: full ? "full" : "rules_only",
    startedAt: now.toISOString(),
    promptVersion: CHAT_PROMPT_VERSION,
    graderVersion: GRADER_VERSION,
    claudeGrading: full
      ? "used"
      : "Skipped: there's no ANTHROPIC_API_KEY, so only the fixed checks ran.",
    score:
      graded.length === 0
        ? null
        : Math.round(graded.reduce((sum, r) => sum + r.score!, 0) / graded.length),
    graded: graded.length,
    skipped: results.length - graded.length,
    costCents: Math.round(spent * 100) / 100,
    capCents,
    stoppedAtCap,
    firstWordsMs: times.length ? { median: median(times), max: Math.max(...times) } : null,
    blockedBy: graded
      .flatMap((r) => r.blockedBy ?? [])
      .reduce<Record<string, number>>(
        (tally, code) => ({ ...tally, [code]: (tally[code] ?? 0) + 1 }),
        {},
      ),
    results,
  };
}
