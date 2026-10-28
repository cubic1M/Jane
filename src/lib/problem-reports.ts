import type { ScopedDb } from "@/lib/db-scoped";

// "Report a problem" (closed beta): the person's own words and the page they were on, kept for the
// founders (/admin/reports). Nothing else goes with it: no balances, no transactions, no
// analytics. Deleted with the person, a trial person's too.

export const REPORT_MAX_CHARS = 2000;
const PATH_MAX_CHARS = 200;

// The page a report is about: its path only. A query is dropped (a search's words are the
// person's), and anything that isn't one of our own pages is just "/".
export function reportPath(from: unknown): string {
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return "/";
  return from.split(/[?#]/)[0].slice(0, PATH_MAX_CHARS) || "/";
}

// What to keep, or what's wrong with it.
export function cleanReport(
  from: unknown,
  message: unknown,
): { path: string; message: string } | string {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "Say what went wrong, in a few words.";
  if (text.length > REPORT_MAX_CHARS) {
    return `Keep it under ${REPORT_MAX_CHARS.toLocaleString("en-US")} characters.`;
  }
  return { path: reportPath(from), message: text };
}

export async function saveProblemReport(
  db: Pick<ScopedDb, "userId" | "problemReports">,
  report: { path: string; message: string },
): Promise<string> {
  const row = await db.problemReports.create({
    data: { userId: db.userId, path: report.path, message: report.message },
    select: { id: true },
  });
  return row.id;
}
