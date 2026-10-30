import type { ReactNode } from "react";
import type { LedgerEntry as Entry, LedgerLine } from "@/lib/ledger";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { STATE_LABEL, type LedgerState } from "@/planning/ledger";

// One line of the savings ledger (src/lib/ledger.ts): its state as a tag, the title and figure;
// on click, the proof, the transaction lines that show it, and the rule it was checked by.

export const STATE_GLYPH: Record<LedgerState, string> = {
  held: "■",
  verified: "●",
  done: "◐",
  estimated: "○",
  not_seen: "×",
};

const MUTED = "text-zinc-600 dark:text-zinc-400";

export function figureOf(e: Pick<Entry, "cents" | "yearly" | "state">): string {
  const counted = e.state === "verified" || e.state === "held";
  // A step with no dollar estimate (moving a due date before a low balance), never "about
  // $0.00/yr" (night QA 10-30).
  if (!counted && e.cents === 0) return "No dollar estimate";
  return `${counted ? "" : "about "}${formatCents(e.cents)}${e.yearly ? "/yr" : ""}`;
}

function Lines({ lines, label }: { lines: LedgerLine[]; label: string }) {
  if (lines.length === 0) return null;
  return (
    <table className="w-full text-xs" aria-label={label}>
      <tbody>
        {lines.map((t) => (
          <tr
            key={t.id}
            data-ledger-line=""
            className="border-t border-zinc-200 dark:border-zinc-800"
          >
            <td className="py-1 pr-2 whitespace-nowrap">{dayLabel(t.date, { year: true })}</td>
            <td className="py-1 pr-2 [overflow-wrap:anywhere]">{t.description}</td>
            <td className="py-1 text-right whitespace-nowrap">
              {t.amountCents < 0 ? "+" : "−"}
              {formatCents(Math.abs(t.amountCents))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LedgerEntryRow({ entry: e, action }: { entry: Entry; action?: ReactNode }) {
  const tag = e.lapsed ? "Came back" : STATE_LABEL[e.state];
  return (
    <li data-ledger-entry={e.state} data-ledger-key={e.key}>
      <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
          <span className="font-mono text-xs tracking-wide uppercase">
            {STATE_GLYPH[e.state]} [{tag}]
          </span>
          {/* A basis, so on a phone the title takes its own line rather than shrinking to a
              letter a line ("Equino / x" in night QA 10-30); words break only when one is too
              long for the line. */}
          <span data-ledger-title="" className="min-w-0 flex-1 basis-48 font-medium break-words">
            {e.title}
          </span>
          <span className="font-semibold whitespace-nowrap">{figureOf(e)}</span>
          {e.confidencePercent !== null && (
            <span className={`text-xs ${MUTED}`}>{e.confidencePercent}% sure</span>
          )}
        </summary>
        <div className="flex flex-col gap-2 border-t border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {e.proof && <p>{e.proof}</p>}
          <Lines lines={e.lines} label="The lines that show it" />
          {e.heldProof && (
            <p>
              {e.lapsed ? "Came back: " : "Held: "}
              {e.heldProof}
            </p>
          )}
          <Lines
            lines={e.heldLines}
            label={e.lapsed ? "The lines that show it came back" : "The lines that show it held"}
          />
          <p className={`text-xs ${MUTED}`}>
            {e.verifiedPercent !== null ? `${e.verifiedPercent}% sure it shows. ` : ""}
            {e.rule}
          </p>
          {action}
        </div>
      </details>
    </li>
  );
}
