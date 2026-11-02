import { plural } from "@/lib/plural";

// What an upload says once it's saved. Rows put right count as news: a file that fixed them mustn't
// say "Nothing new" (debugger 11-02).
const REST = "Jane finishes the rest in the background; the bar at the top shows how it's going.";

export function savedLine({
  rows,
  read,
  corrected,
}: {
  rows: number;
  // How many the files had.
  read: number;
  corrected: number;
}): string {
  if (corrected > 0) {
    return rows === 0
      ? `Put right ${plural(corrected, "transaction")} Jane already had; nothing new. ${REST}`
      : `Saved ${plural(rows, "new transaction")} and put right ${corrected} Jane already had. ${REST}`;
  }
  if (rows === 0) {
    return `Nothing new: Jane already had ${read === 1 ? "this transaction" : `all ${read} of these transactions`}.`;
  }
  const already = read - rows;
  return `Saved ${plural(rows, rows < read ? "new transaction" : "transaction")}${rows < read ? `; ${already} ${already === 1 ? "was" : "were"} already here` : ""}. ${REST}`;
}
