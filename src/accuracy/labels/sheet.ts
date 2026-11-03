import { readCsvFile } from "@/data-sources/csv/csv-source";
import { parseCsv } from "@/data-sources/csv/parse-csv";
import { parseMoneyToCents } from "@/lib/money";
import { rowId, type SheetRow } from "./labels";

// The sheet each founder labels: one row per transaction from their statements. It holds no guess
// of Jane's, so no label leans on Jane's. Read with Jane's own statement reader.

const COLUMNS = ["id", "date", "amount", "description", "bank_category", "bank_type", "label"];
const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

export function sheetFromStatements(files: readonly { name: string; text: string }[]): {
  sheet: string;
  rows: number;
  unread: string[];
} {
  const seen = new Map<string, number>();
  const lines = [COLUMNS.join(",")];
  const unread: string[] = [];
  let rows = 0;
  for (const file of files) {
    const result = readCsvFile(file);
    if (!result.ok) {
      unread.push(file.name);
      continue;
    }
    for (const t of result.transactions) {
      const base = `${t.date}|${t.amountCents}|${t.description}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      const id = rowId(t, occurrence);
      lines.push(
        [
          id,
          t.date,
          (t.amountCents / 100).toFixed(2),
          t.description,
          t.hints.bankCategory ?? "",
          t.hints.bankType ?? "",
          "",
        ]
          .map(cell)
          .join(","),
      );
      rows += 1;
    }
  }
  return { sheet: `${lines.join("\n")}\n`, rows, unread };
}

export function readSheet(text: string): (SheetRow & { label: string })[] {
  const [header, ...rows] = parseCsv(text);
  const at = (name: string) =>
    header?.fields.findIndex((f) => f.trim().toLowerCase() === name) ?? -1;
  const [id, date, amount, description, bankCategory, bankType, label] = COLUMNS.map(at) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (id < 0 || label < 0) throw new Error("A sheet needs its id and label columns.");
  return rows.flatMap(({ fields }) => {
    const cents = parseMoneyToCents(fields[amount] ?? "");
    if (cents === null) return [];
    return [
      {
        id: fields[id] ?? "",
        date: fields[date] ?? "",
        amountCents: cents,
        description: fields[description] ?? "",
        bankCategory: fields[bankCategory] || undefined,
        bankType: fields[bankType] || undefined,
        label: fields[label] ?? "",
      },
    ];
  });
}
