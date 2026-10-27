// A small RFC 4180 reader: quoted fields, "" escapes, commas and newlines inside quotes,
// CRLF or LF line endings, and a leading byte-order mark. Blank lines are dropped.
// Each record keeps the 1-based line it started on, for "skipped row" messages. Fields are
// split on commas, or on semicolons or tabs when the file uses those (European exports).

export type CsvRecord = { line: number; fields: string[] };

const DELIMITERS = [",", ";", "\t"] as const;
const SNIFF_LINES = 10;

// The separator, from the first lines outside quotes: the one found the same number of times
// on every line (a column boundary), else the one used most on most lines. Commas win a tie.
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, SNIFF_LINES)
    .map((line) => line.replace(/"(?:[^"]|"")*"/g, ""));
  if (lines.length === 0) return ",";
  const countsOf = (d: string) => lines.map((line) => line.split(d).length - 1);
  const steady = DELIMITERS.filter((d) => {
    const counts = countsOf(d);
    return counts[0] > 0 && counts.every((c) => c === counts[0]);
  });
  if (steady.length > 0) {
    return steady.reduce((a, b) => (countsOf(b)[0] > countsOf(a)[0] ? b : a));
  }
  const wins = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  for (const line of lines) {
    const counts = DELIMITERS.map((d) => [d, line.split(d).length - 1] as const);
    const [best, count] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (count > 0) wins.set(best, (wins.get(best) ?? 0) + 1);
  }
  return DELIMITERS.reduce((a, b) => ((wins.get(b) ?? 0) > (wins.get(a) ?? 0) ? b : a));
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvRecord[] {
  const input = text.startsWith("\ufeff") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0].trim() !== "") {
      records.push({ line: recordLine, fields });
    }
    fields = [];
    field = "";
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line++;
        field += char;
      }
    } else if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new Error("The file has an unclosed quote, so it can't be read as CSV.");
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}
