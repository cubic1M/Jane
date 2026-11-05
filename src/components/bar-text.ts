// A loading bar in ASCII: "[████████░░░░░░░░] 52% · reading transactions". Its own small file: every
// page's loading bar uses it, and only a first scan needs the rest of its stages.
export const BAR_CELLS = 16;

export function scanBarText(percent: number, label: string): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((p / 100) * BAR_CELLS);
  return `[${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}] ${p}% · ${label.toLowerCase()}`;
}
