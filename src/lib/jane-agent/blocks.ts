import { CHAT_BLOCK_ROWS, CHAT_BLOCK_WIDTH } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";

// Answer blocks (spec step 94): what an answer can show besides its words, drawn in
// monospace text in the ASCII style: a bar chart, a table of options, a timeline of what's
// due, progress bars. Each is plain data on the message (refs.block); drawBlock turns it into
// lines no wider than CHAT_BLOCK_WIDTH, so it fits a phone, and a text alternative for
// screen readers. Pure. Figures come from the same loaders as the pages (./block-data.ts).

export type AnswerBlock =
  | { type: "bars"; title: string; rows: { label: string; cents: number }[] }
  | { type: "table"; title: string; columns: string[]; rows: string[][] }
  | {
      type: "timeline";
      title: string;
      rows: { date: string; label: string; cents: number | null }[];
    }
  | {
      type: "progress";
      title: string;
      rows: { label: string; doneCents: number; totalCents: number }[];
    };

export type DrawnBlock = { title: string; lines: string[]; alt: string };

const W = CHAT_BLOCK_WIDTH;

// Cut to n characters, with "…" when cut.
const fit = (text: string, n: number) =>
  text.length <= n ? text : `${text.slice(0, Math.max(0, n - 1)).trimEnd()}…`;
const padEnd = (text: string, n: number) => fit(text, n).padEnd(n);
const money = (cents: number) => formatCents(cents);

// "Oct 20", from YYYY-MM-DD.
const day = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : iso;

function bars(block: Extract<AnswerBlock, { type: "bars" }>): DrawnBlock {
  const rows = block.rows.slice(0, CHAT_BLOCK_ROWS);
  const amounts = rows.map((r) => money(r.cents));
  const amountWidth = Math.max(0, ...amounts.map((a) => a.length));
  const labelWidth = Math.min(10, Math.max(0, ...rows.map((r) => r.label.length)));
  const barWidth = Math.max(1, W - labelWidth - amountWidth - 2);
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return {
    title: block.title,
    lines: rows.map((r, i) => {
      const filled = r.cents > 0 ? Math.max(1, Math.round((r.cents / max) * barWidth)) : 0;
      return `${padEnd(r.label, labelWidth)} ${"█".repeat(filled).padEnd(barWidth)} ${amounts[i].padStart(amountWidth)}`;
    }),
    alt: `${block.title}: ${rows.map((r, i) => `${r.label} ${amounts[i]}`).join(", ")}.`,
  };
}

function table(block: Extract<AnswerBlock, { type: "table" }>): DrawnBlock {
  const rows = block.rows.slice(0, CHAT_BLOCK_ROWS);
  const all = [block.columns, ...rows];
  const count = block.columns.length;
  // Every column but the first as wide as its widest cell; the first takes what's left.
  const widths = block.columns.map((_, c) => Math.max(...all.map((r) => (r[c] ?? "").length)));
  const rest = widths.slice(1).reduce((sum, w) => sum + w + 1, 0);
  widths[0] = Math.max(4, Math.min(widths[0], W - rest));
  const line = (cells: string[]) =>
    cells
      .slice(0, count)
      .map((cell, c) =>
        c === 0 ? padEnd(cell, widths[0]) : fit(cell, widths[c]).padStart(widths[c]),
      )
      .join(" ");
  return {
    title: block.title,
    lines: [
      line(block.columns),
      "-".repeat(Math.min(W, line(block.columns).length)),
      ...rows.map(line),
    ],
    alt: `${block.title}: ${rows
      .map((r) => block.columns.map((col, c) => `${col} ${r[c] ?? ""}`).join(", "))
      .join("; ")}.`,
  };
}

function timeline(block: Extract<AnswerBlock, { type: "timeline" }>): DrawnBlock {
  const rows = block.rows.slice(0, CHAT_BLOCK_ROWS);
  const amounts = rows.map((r) => (r.cents === null ? "" : money(r.cents)));
  const amountWidth = Math.max(0, ...amounts.map((a) => a.length));
  const labelWidth = Math.max(1, W - 6 - 3 - amountWidth - 1);
  return {
    title: block.title,
    lines: rows.map(
      (r, i) =>
        `${day(r.date).padEnd(6)} ${i === rows.length - 1 ? "└" : "├"} ${padEnd(r.label, labelWidth)} ${amounts[i].padStart(amountWidth)}`,
    ),
    alt: `${block.title}: ${rows
      .map((r, i) => `${day(r.date)}, ${r.label}${amounts[i] ? `, ${amounts[i]}` : ""}`)
      .join("; ")}.`,
  };
}

function progress(block: Extract<AnswerBlock, { type: "progress" }>): DrawnBlock {
  const rows = block.rows.slice(0, CHAT_BLOCK_ROWS);
  const barWidth = W - 2 - 5;
  const lines: string[] = [];
  const alts: string[] = [];
  for (const r of rows) {
    const share = r.totalCents > 0 ? Math.min(1, Math.max(0, r.doneCents / r.totalCents)) : 0;
    const filled = Math.round(share * barWidth);
    const percent = `${Math.round(share * 100)}%`;
    lines.push(
      fit(r.label, W),
      `[${"#".repeat(filled)}${"-".repeat(barWidth - filled)}] ${percent.padStart(4)}`,
      fit(`${money(r.doneCents)} of ${money(r.totalCents)}`, W),
    );
    alts.push(`${r.label}: ${money(r.doneCents)} of ${money(r.totalCents)}, ${percent}`);
  }
  return { title: block.title, lines, alt: `${block.title}: ${alts.join("; ")}.` };
}

export function drawBlock(block: AnswerBlock): DrawnBlock {
  switch (block.type) {
    case "bars":
      return bars(block);
    case "table":
      return table(block);
    case "timeline":
      return timeline(block);
    case "progress":
      return progress(block);
  }
}

// The figures a block shows, for the guardrails.
export function blockCents(block: AnswerBlock): number[] {
  switch (block.type) {
    case "bars":
      return block.rows.map((r) => r.cents);
    case "timeline":
      return block.rows.flatMap((r) => (r.cents === null ? [] : [r.cents]));
    case "progress":
      return block.rows.flatMap((r) => [r.doneCents, r.totalCents]);
    case "table":
      return [];
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Reads one back from a message's refs, or null when it's malformed.
export function parseBlock(value: unknown): AnswerBlock | null {
  if (!isObject(value) || typeof value.title !== "string" || !Array.isArray(value.rows)) {
    return null;
  }
  if (!["bars", "table", "timeline", "progress"].includes(String(value.type))) return null;
  if (value.type === "table" && !Array.isArray(value.columns)) return null;
  return value as AnswerBlock;
}
