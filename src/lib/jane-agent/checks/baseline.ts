import type { PrismaClient } from "@/generated/prisma/client";
import { answerByRules } from "../answer";
import { parseIntent } from "../intents";
import { QUESTIONS } from "./bank";

// How much of the question bank the rules alone understand (spec step 189): each question
// is asked of the rules as the first thing in a conversation, with no key and no Claude.
// "Understood" means the rules gave an answer of their own rather than the generic
// fallback. This is the baseline Claude-first (step 191) is measured against, by sector and
// by page. A follow-up (after another question) is skipped: it needs the conversation.

export type Understood = {
  id: string;
  text: string;
  sector: string;
  page: string;
  tool: string | null;
  understood: boolean;
  intent: string;
  ms: number;
};

export type Baseline = {
  asked: number;
  understood: number;
  bySector: Record<string, { asked: number; understood: number }>;
  byPage: Record<string, { asked: number; understood: number }>;
  rows: Understood[];
};

const PARALLEL = 6;

const GROUPS: Record<string, string> = {
  safe: "safe",
  due: "bills",
  pay: "income",
  act: "subs",
  follow: "follow",
  free: "free",
  out: "edge",
  tax: "taxes",
  ins: "insurance",
  inv: "investing",
  whole: "whole",
  multi: "multi",
  timeline: "timeline",
};

// Sector and page for a question from before this step, which only carry an id.
const sectorOf = (id: string) => GROUPS[id.split("-")[0]] ?? id.split("-")[0];

export async function measureBaseline(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Baseline> {
  const asOf = now.toISOString().slice(0, 10);
  const asked = QUESTIONS.filter((q) => !q.after);
  const one = async (q: (typeof asked)[number]): Promise<Understood> => {
    const started = performance.now();
    const intent = parseIntent(q.text, asOf);
    const reply =
      intent.kind === "unknown" ? null : await answerByRules(userId, intent, { client, now });
    return {
      id: q.id,
      text: q.text,
      sector: q.sector ?? sectorOf(q.id),
      page: q.page ?? "/chat",
      tool: q.tool ?? null,
      understood: reply !== null,
      intent: intent.kind,
      ms: Math.round(performance.now() - started),
    };
  };
  // A few at a time, so the whole bank runs in well under five minutes.
  const rows: Understood[] = [];
  for (let i = 0; i < asked.length; i += PARALLEL) {
    rows.push(...(await Promise.all(asked.slice(i, i + PARALLEL).map(one))));
  }
  const tally = (key: (r: Understood) => string) => {
    const out: Record<string, { asked: number; understood: number }> = {};
    for (const r of rows) {
      const t = (out[key(r)] ??= { asked: 0, understood: 0 });
      t.asked += 1;
      if (r.understood) t.understood += 1;
    }
    return out;
  };
  return {
    asked: rows.length,
    understood: rows.filter((r) => r.understood).length,
    bySector: tally((r) => r.sector),
    byPage: tally((r) => r.page),
    rows,
  };
}

const pct = (a: number, b: number) => (b === 0 ? "–" : `${Math.round((a / b) * 100)}%`);

// The table that goes in docs/chat-quality.md.
export function formatBaseline(b: Baseline): string {
  const table = (title: string, data: Baseline["bySector"]) =>
    [
      `| ${title} | Asked | Rules understood |`,
      "| --- | ---: | ---: |",
      ...Object.entries(data)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => `| ${k} | ${v.asked} | ${pct(v.understood, v.asked)} |`),
    ].join("\n");
  return [
    `Rules understood ${b.understood} of ${b.asked} first questions (${pct(b.understood, b.asked)}).`,
    "",
    table("Sector", b.bySector),
    "",
    table("Page", b.byPage),
  ].join("\n");
}
