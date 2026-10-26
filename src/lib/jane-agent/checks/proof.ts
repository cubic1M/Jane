import { PROOF_CASUAL_QUESTIONS, PROOF_TOOL_MS } from "@/config/proof";
import type { Person } from "@/config/people";
import { DETECTORS } from "@/detectors";
import { reportFor, topThreeFor } from "@/detectors/harness";
import type { PrismaClient } from "@/generated/prisma/client";
import { offeredToday, scanSuggestions } from "@/lib/suggestions";
import { answerByRules } from "../answer";
import { CHAT_TOOLS, runChatTool } from "../claude-tools";
import { parseIntent } from "../intents";
import { cardsLine } from "../agenda";
import { chatFeed } from "../messages";
import { runJaneAgent } from "../run";
import { MORE_ROWS } from "./bank-more";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";

// Proof on every person (spec step 266): each sample person walked through what Jane brings
// them and through the chat, as a person would meet it. Their demo bank is linked and
// scanned; the scan's top suggestions are compared with their written list; the first chat is
// read for the suggestions it leads with; every tool behind a top suggestion is run (Claude's
// figures); and the questions for those features, plus QA's casual ones, are asked. Without a
// key this walks the rules and the tools; the live Claude walk is QA's graded run.

export type ProofQuestion = {
  text: string;
  understood: boolean;
  answer: string;
  // Asked about a suggestion Jane made: an answer that says it sees nothing for it
  // contradicts the suggestion.
  about?: string;
  contradicts?: boolean;
};

// An answer saying Jane has nothing to go on.
const NOTHING_THERE =
  /\bI don't see\b|\bthere's no\b.*\byet\b|\bLink (?:the|an|your) account\b|\bnothing to\b/i;

export type ProofSuggestion = {
  key: string;
  headline: string;
  confidence: string;
  onList: boolean;
  mustNot: boolean;
  tools: { name: string; ok: boolean; ms: number; error?: string }[];
};

export type PersonProof = {
  person: Pick<Person, "id" | "name" | "label">;
  // The pure harness's top three (what the scan ranks), and what the scan offered in the chat.
  topThree: string[];
  offered: ProofSuggestion[];
  sameAsHarness: boolean;
  // The first chat's opening lines and whether they lead with the suggestions.
  opening: string[];
  leadsWithSuggestions: boolean;
  missed: string[];
  wrong: string[];
  questions: ProofQuestion[];
  pass: boolean;
  problems: string[];
};

const firstLine = (s: string) => s.split("\n")[0].slice(0, 160);

async function ask(
  userId: string,
  text: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ProofQuestion> {
  const intent = parseIntent(text, now.toISOString().slice(0, 10));
  if (intent.kind === "unknown") return { text, understood: false, answer: "(for Claude)" };
  const reply = await answerByRules(userId, intent, { client, now }).catch(() => null);
  return {
    text,
    understood: Boolean(reply?.body),
    answer: reply?.body ? firstLine(reply.body) : "(no rule answer)",
  };
}

// What a card's tool is asked: nothing, or for a tool that needs an input, the card's own
// topic where it is one of that input's choices (the consolidation card asks loan_fit about
// need "consolidation", as the chat would).
export function inputFor(tool: string, topic: string): Record<string, string> {
  const schema = CHAT_TOOLS.find((t) => t.name === tool)?.input_schema as
    { required?: string[]; properties?: Record<string, { enum?: readonly string[] }> } | undefined;
  const input: Record<string, string> = {};
  for (const field of schema?.required ?? []) {
    if (schema?.properties?.[field]?.enum?.includes(topic)) input[field] = topic;
  }
  return input;
}

export async function proveOn(
  person: Person,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<PersonProof> {
  const report = reportFor(person);
  const top = topThreeFor(report);
  // As a visitor meets them: Try Jane with this person's sample data.
  const trial = await startTrial({ client, now, defer: true, person: person.id });
  await syncItem(trial.itemId, { client, now });
  const userId = trial.userId;
  try {
    await scanSuggestions(userId, { client, now });
    const offered = await offeredToday(userId, { client, now });
    await runJaneAgent(userId, { client, now, trigger: "open" });
    const { messages } = await chatFeed(userId, { client, now });
    // The day's agenda: the brief that leads with what Jane would do first.
    const brief =
      messages.find((m) => m.kind === "brief" && /Good (morning|afternoon|evening)/.test(m.body)) ??
      messages.find((m) => m.kind === "brief");
    const opening = (brief?.body ?? "").split("\n").filter(Boolean).slice(0, 6);

    const suggestions: ProofSuggestion[] = [];
    const questions: ProofQuestion[] = [];
    for (const s of offered) {
      const detector = DETECTORS.find((d) => `${d.capability}:${d.topic}` === s.key);
      const tools = [];
      for (const name of detector?.covers ?? []) {
        const started = Date.now();
        try {
          const out = await runChatTool(userId, name, inputFor(name, s.topic), { client, now });
          const parsed = JSON.parse(out.content) as { error?: unknown };
          tools.push({
            name,
            ok: !parsed.error,
            ms: Date.now() - started,
            ...(parsed.error ? { error: String(parsed.error) } : {}),
          });
        } catch (error) {
          tools.push({ name, ok: false, ms: Date.now() - started, error: String(error) });
        }
      }
      suggestions.push({
        key: s.key,
        headline: s.headline || s.title,
        confidence: `${s.confidencePercent}% (${s.confidenceReason})`,
        onList: person.should.includes(s.topic as never),
        mustNot: person.mustNot.includes(s.topic as never),
        tools,
      });
      // The bank's questions for the features behind it, one each.
      for (const name of detector?.covers ?? []) {
        const row = MORE_ROWS.find((r) => r[2] === name);
        if (!row) continue;
        const q = await ask(userId, row[3], { client, now });
        questions.push({
          ...q,
          about: s.key,
          contradicts: q.understood && NOTHING_THERE.test(q.answer),
        });
      }
    }
    for (const text of PROOF_CASUAL_QUESTIONS)
      questions.push(await ask(userId, text, { client, now }));

    const offeredTopics = offered.slice(0, 3).map((s) => s.key.split(":")[1]);
    // The suggestions lead on the floating cards (the one place they show, #544), and the first
    // chat says once that they're there.
    const cards = (
      await client.janeMessage.findMany({
        where: { userId, status: "open", refs: { path: ["suggestion"], string_contains: ":" } },
        select: { body: true },
      })
    )
      .map((m) => m.body)
      .join("\n");
    const leads =
      offered.length > 0 &&
      (brief?.body ?? "").includes(cardsLine(offered.length)) &&
      offered.slice(0, 3).every((s) => cards.includes((s.headline || s.title).split(",")[0]));
    const problems = [
      ...suggestions.filter((s) => s.mustNot).map((s) => `must-not suggestion ${s.key}`),
      ...suggestions.filter((s) => !s.onList).map((s) => `off-list suggestion ${s.key}`),
      ...suggestions.flatMap((s) =>
        s.tools.filter((t) => !t.ok).map((t) => `${t.name} failed${t.error ? `: ${t.error}` : ""}`),
      ),
      ...suggestions.flatMap((s) =>
        s.tools.filter((t) => t.ok && t.ms > PROOF_TOOL_MS).map((t) => `${t.name} took ${t.ms}ms`),
      ),
      ...(top.pass ? [] : [`harness top three ${top.topics.join(", ")} not all on the list`]),
      ...(leads ? [] : ["the first chat doesn't lead with the suggestions"]),
      ...questions
        .filter((q) => q.contradicts)
        .map((q) => `"${q.text}" says there's nothing there, after suggesting ${q.about}`),
      ...report.wrong.map((s) => `wrong suggestion ${s.topic}`),
    ];
    return {
      person: { id: person.id, name: person.name, label: person.label },
      topThree: top.topics,
      offered: suggestions,
      sameAsHarness: offeredTopics.join() === top.topics.join(),
      opening,
      leadsWithSuggestions: leads,
      missed: report.missed.map((m) => m.topic),
      wrong: report.wrong.map((s) => s.topic),
      questions,
      pass: problems.length === 0,
      problems,
    };
  } finally {
    await client.user.deleteMany({ where: { id: userId } });
  }
}

const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

// The proof as Markdown, for docs/proof-on-every-person.md.
export function formatProof(proofs: readonly PersonProof[], ranOn: string): string {
  const out: string[] = [
    "# Proof on every person (spec step 266)",
    "",
    `Run on ${ranOn} with \`npm run checks:proof\` (src/lib/jane-agent/checks/proof.ts): each sample person's demo bank linked and scanned, their top suggestions compared with their written list (src/config/people.ts), the first chat read, every tool behind a top suggestion run, and the questions for those features plus QA's casual ones asked. Without an Anthropic key the chat walk uses the rules and the tools; the live Claude walk is QA's graded run.`,
    "",
    "| Person | Top three (harness) | Offered in the chat | Leads the first chat | Questions understood by the rules | Result |",
    "| --- | --- | --- | --- | --- | --- |",
    ...proofs.map((p) => {
      const understood = p.questions.filter((q) => q.understood).length;
      return `| ${p.person.name} | ${p.topThree.join(", ")} | ${p.offered.length} | ${p.leadsWithSuggestions ? "yes" : "no"} | ${understood}/${p.questions.length} | ${p.pass ? "pass" : "FAIL"} |`;
    }),
    "",
  ];
  for (const p of proofs) {
    out.push(`## ${p.person.name}: ${p.person.label}`, "");
    out.push("What Jane brought, ranked:", "");
    out.push(
      "| Suggestion | Confidence | On their list | Tools (ms) |",
      "| --- | --- | --- | --- |",
    );
    for (const s of p.offered) {
      out.push(
        `| ${cell(s.headline)} | ${cell(s.confidence)} | ${s.mustNot ? "MUST NOT" : s.onList ? "yes" : "no"} | ${s.tools.map((t) => `${t.name} ${t.ok ? t.ms : "failed"}`).join(", ") || "none"} |`,
      );
    }
    out.push("", "The first chat opens:", "", ...p.opening.map((l) => `> ${cell(l)}`), "");
    if (p.missed.length > 0)
      out.push(`On their list but not found yet: ${p.missed.join(", ")}.`, "");
    out.push("| Question | Understood | First line of the answer |", "| --- | --- | --- |");
    for (const q of p.questions) {
      out.push(
        `| ${cell(q.text)} | ${q.understood ? (q.contradicts ? "CONTRADICTS" : "yes") : "Claude"} | ${cell(q.answer)} |`,
      );
    }
    out.push(
      "",
      p.problems.length === 0 ? "No problems." : `Problems: ${p.problems.join("; ")}.`,
      "",
    );
  }
  return out.join("\n");
}
