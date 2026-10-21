import { dollarFigures } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";
import { rankedFor } from "./priorities";
import type { Snapshot } from "./snapshot";

// "What matters most" for Claude's primer (the person's numbers sent with each question): the
// top three things to do, the scan's suggestions first and then the ranked list, and the open
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
  const scan = (snapshot.suggestions ?? []).map((s) => {
    cents.push(s.worthCents);
    return {
      what: trim(s.title),
      why: note(trim(s.why)),
      worth:
        s.worthKind === "risk"
          ? `a loss of about ${formatCents(s.worthCents)} avoided`
          : `${formatCents(s.worthCents)} a year`,
      sureness: `${s.confidencePercent}% sure, based on ${s.confidenceReason}`,
    };
  });
  const ranked = rankedFor(snapshot)
    .filter((r) => r.kind !== "deadline")
    .map((r) => {
      if (r.valueCents !== null) cents.push(r.valueCents);
      return {
        what: trim(r.title),
        why: note(trim(r.why)),
        worth:
          r.valueCents === null
            ? null
            : `${formatCents(r.valueCents)}${r.once ? " once" : " a year"}`,
      };
    });
  const matters = [...scan, ...ranked].slice(0, TOP);
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
