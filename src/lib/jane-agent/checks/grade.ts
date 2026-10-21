import { ANSWER_FIRST_SENTENCE_MAX, ANSWER_MAX_CHARS } from "@/config/answer-checks";
import { ASK_BLOCKED_REPLY } from "@/config/ask";
import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";
import { CHAT_UNAVAILABLE_TEXT } from "../claude";
import { parseIntent } from "../intents";
import { unknownReply } from "../replies";
import type { MessageAction } from "../types";
import type { AnswerSource } from "../typing";
import type { CheckQuestion } from "./bank";
import type { Facts } from "./facts";

// The fixed checks on one of Jane's answers (spec step 87). Pure: the question, the answer
// and the person's numbers in; each check passed or failed with its reason out. They need
// no Claude, so they run in CI.

export type Answer = {
  body: string;
  actions: MessageAction[];
  // How it was answered (src/lib/jane-agent/typing.ts).
  source: AnswerSource;
};

export type Check = { name: string; ok: boolean; reason: string };

const pass = (name: string, reason = ""): Check => ({ name, ok: true, reason });
const fail = (name: string, reason: string): Check => ({ name, ok: false, reason });

// Openers that put words before the answer (spec step 89: the answer comes first).
const FILLER =
  /^(?:sure|great question|good question|of course|certainly|absolutely|happy to help|i'?d be happy|i can help|let me|okay|ok|so|well|hmm)\b/i;
// "Tap the button" with nothing else is no answer (the founder saw this).
const BARE_BUTTON = /\btap (?:the |a )?(?:button|yes|below)\b/i;
// Money says "$17.99 a month", not "/mo" or "per month".
const MONEY_STYLE = /\$[\d,.]+\s*(?:\/\s?(?:mo|month|yr|year)\b|per (?:month|year)\b)/i;
const NOT_ANSWERED = [unknownReply().body, CHAT_UNAVAILABLE_TEXT, ASK_BLOCKED_REPLY];

// The first sentence, up to its full stop, question mark or line end.
export function firstSentence(body: string): string {
  const line = body.trim().split("\n")[0];
  const end = /[.!?](?:\s|$)/.exec(line);
  return end ? line.slice(0, end.index + 1) : line;
}

export function fixedChecks(
  question: CheckQuestion,
  answer: Answer,
  facts: Facts,
  // Earlier turns of this conversation: figures there can be used again.
  earlier: readonly string[] = [],
): Check[] {
  const { expect } = question;
  const body = answer.body.trim();
  const checks: Check[] = [];

  // Answered, not a fallback.
  const fellBack =
    answer.source === "fallback" ||
    answer.source === "claude_unavailable" ||
    NOT_ANSWERED.includes(body);
  checks.push(
    fellBack
      ? fail("answered", "Jane didn't answer: she fell back to what she can do.")
      : answer.source === "claude_blocked"
        ? fail("answered", "The guardrails blocked Jane's answer.")
        : pass("answered"),
  );

  // Chat architecture (docs/spec.md): every reply is written words, at least a real sentence;
  // a button or a card is never the whole reply.
  const words = body.split(/\s+/).filter(Boolean).length;
  checks.push(
    words >= 3 && !(BARE_BUTTON.test(body) && body.length < 80)
      ? pass("written")
      : fail(
          "written",
          "The reply isn't a written answer: a button or a few words is not an answer.",
        ),
  );

  // What the rules read it as.
  if (expect.intent) {
    const intent = parseIntent(question.text, facts.asOf).kind;
    checks.push(
      intent === expect.intent
        ? pass("understood")
        : fail("understood", `Read as "${intent}", not "${expect.intent}".`),
    );
  }

  // The right figures.
  const shown = new Set(dollarFigures(body).map((f) => f.cents));
  const wanted = (expect.figures?.(facts) ?? []).filter((c): c is number => c !== null);
  if (wanted.length > 0) {
    const missing = wanted.filter((c) => !shown.has(Math.abs(c)));
    checks.push(
      missing.length === 0
        ? pass("figures")
        : fail("figures", `Missing ${missing.map((c) => formatCents(Math.abs(c))).join(", ")}.`),
    );
  }

  // Nothing the guardrails refuse. Fixed answers (the rules, the fallback) take their
  // figures from the same loaders, so only Claude's are held to the figures the lookups gave.
  const allowed = [question.text, ...earlier].flatMap((t) => dollarFigures(t).map((f) => f.cents));
  allowed.push(...facts.allowedCents);
  const guard = checkGuardrails(
    body,
    answer.source === "claude" ? allowed : [...shown],
    undefined,
    // As Jane checks her own answers for this person (spec steps 98, 137).
    facts.advice ? "demo_advice" : "standard",
  );
  checks.push(
    guard.ok
      ? pass("guardrails")
      : fail("guardrails", `The guardrails would refuse it: ${guard.issues.join(", ")}.`),
  );

  // Step 89's shape: the answer first, no filler, never just a button, a list only when
  // one fits.
  const first = firstSentence(body);
  const shape: string[] = [];
  if (FILLER.test(body)) shape.push("it opens with filler");
  if (/:$/.test(first) || /^if\b/i.test(first))
    shape.push("the first sentence leads in instead of answering");
  if (first.length > ANSWER_FIRST_SENTENCE_MAX) shape.push("the first sentence is too long");
  if (BARE_BUTTON.test(body) && body.length < 80) shape.push("it only points at a button");
  const listLines = body.split("\n").filter((l) => /^\s*(?:-|\d+\.)\s/.test(l)).length;
  if (listLines > 0 && !expect.list) shape.push("it's a list where an answer fits");
  checks.push(shape.length === 0 ? pass("shape") : fail("shape", `Shape: ${shape.join("; ")}.`));

  // Tone: Jane's money style.
  checks.push(
    MONEY_STYLE.test(body)
      ? fail("tone", 'Money should read "$17.99 a month", not "/mo" or "per month".')
      : pass("tone"),
  );

  // The right button.
  if (expect.button) {
    checks.push(
      answer.actions.some((a) => a.id === expect.button)
        ? pass("button")
        : fail("button", `No "${expect.button}" button.`),
    );
  }
  if (expect.link) {
    checks.push(
      answer.actions.some((a) => a.kind === "link" && a.href.startsWith(expect.link!))
        ? pass("link")
        : fail("link", `No link to ${expect.link}.`),
    );
  }

  if (expect.mentions) {
    checks.push(
      expect.mentions.test(body)
        ? pass("mentions")
        : fail("mentions", `Doesn't mention ${expect.mentions.source}.`),
    );
  }
  if (expect.avoid) {
    checks.push(
      expect.avoid.test(body)
        ? fail("avoids", `Says what it shouldn't (${expect.avoid.source}).`)
        : pass("avoids"),
    );
  }

  if (expect.maxSentences) {
    // The "85% sure: ..." line under a decision is the evidence, not part of the answer.
    const count = body
      .split("\n")
      .filter((l) => !/^\d+% sure:/.test(l))
      .join(" ")
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean).length;
    checks.push(
      count <= expect.maxSentences
        ? pass("sentences")
        : fail("sentences", `${count} sentences, over ${expect.maxSentences}.`),
    );
  }

  const max = expect.maxChars ?? ANSWER_MAX_CHARS;
  checks.push(
    body.length <= max ? pass("length") : fail("length", `${body.length} characters, over ${max}.`),
  );
  return checks;
}

// 0–100: the share of checks passed.
export function fixedScore(checks: readonly Check[]): number {
  return checks.length === 0
    ? 0
    : Math.round((100 * checks.filter((c) => c.ok).length) / checks.length);
}

export function reasonOf(checks: readonly Check[]): string {
  const failed = checks.filter((c) => !c.ok).map((c) => c.reason);
  return failed.length === 0 ? "Passed every check." : failed.join(" ");
}
