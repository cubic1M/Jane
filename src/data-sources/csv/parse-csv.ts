// A small RFC 4180 reader: quoted fields, "" escapes, commas and newlines inside quotes,
// CRLF or LF line endings, and a leading byte-order mark. Blank lines are dropped.
// Each record keeps the 1-based line it started on, for "skipped row" messages.

export type CsvRecord = { line: number; fields: string[] };

export function parseCsv(text: string): CsvRecord[] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
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
    } else if (char === ",") {
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
