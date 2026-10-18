import { createHash } from "node:crypto";
import { normalizeDescription } from "@/data-sources/merchant";

// CSV rows have no bank id, so a row is identified by date, amount and description plus
// how many identical rows came before it in the same file. Two real coffees on the same
// day stay two rows; uploading the same file twice, or two exports that overlap, adds
// nothing new. Keys are unique per account in the database.
export function dedupeKeys(rows: { date: string; amountCents: number; description: string }[]) {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${row.date}|${row.amountCents}|${normalizeDescription(row.description)}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return createHash("sha256").update(`${base}|${occurrence}`).digest("hex").slice(0, 32);
  });
}
