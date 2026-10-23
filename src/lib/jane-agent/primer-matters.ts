import { dollarFigures } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";
import { rankedFor } from "./priorities";
import type { Snapshot } from "./snapshot";

// "What matters most" for Claude's primer (the person's numbers sent with each question): the
// top three things to do from the one ranked list (the scan's suggestions lead it), and the open
// findings with what they save. With it in the primer, "what should I do first", "why" and
// "what am I doing wrong" need no tool round (each costs seconds). Pure; the dollar figures
// count as allowed cents for the guardrails like any other primer figure.

const TOP = 3;
const trim = (text: string) => text.replace(/\s+/g, " ").trim();

export function mattersBlock(snapshot: Snapshot | null): { text: string; cents: number[] } {
  if (!snapshot) return { text: "", cents: [] };
  const cents: number[] = [];
  const note = (text: string) => {
    cents.push(...dollarFigures(text).map((f) => f.cents));
    return text;
  };
  // The one ranked list (./priorities.ts): the scan's suggestions first, then the rest.
  const why = new Map((snapshot.suggestions ?? []).map((s) => [s.key, s.why]));
  const matters = rankedFor(snapshot)
    .filter((r) => r.kind !== "deadline")
    .slice(0, TOP)
    .map((r) => {
      if (r.valueCents !== null) cents.push(r.valueCents);
      return {
        what: trim(r.title),
        why: note(trim((r.kind === "suggestion" && r.ref && why.get(r.ref)) || r.why)),
        worth:
          r.valueCents === null
            ? null
            : r.risk
              ? `a loss of about ${formatCents(r.valueCents)} avoided`
              : `${formatCents(r.valueCents)}${r.once ? " once" : " a year"}`,
        ...(r.sure ? { sureness: `${r.sure.percent}% sure, based on ${r.sure.reason}` } : {}),
      };
    });
  const findings = [...snapshot.findings].sort(
    (a, b) => (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1),
  );
  for (const f of findings.slice(0, TOP)) {
    if (f.annualSavingsCents !== null) cents.push(f.annualSavingsCents);
  }
  const lines = [
    `what_matters_most: ${JSON.stringify(matters)}`,
    `open_findings_summary: ${JSON.stringify({
      count: findings.length,
      top: findings.slice(0, TOP).map((f) => ({
        title: trim(f.title),
        saves: f.annualSavingsCents === null ? null : `${formatCents(f.annualSavingsCents)} a year`,
      })),
    })}`,
  ];
  return { text: lines.join("\n"), cents };
}
