import type { ChartAccountTranscript, ChartRecord } from "./api";

// Chart's account transcripts in the IRS's own layout, so Jane's one transcript reader
// (parseTranscript, from the transcript upload) reads them: the same codes, Jane's own words for
// them, and the same tax year and balance. Chart's names, TINs and addresses aren't carried over.
// A transaction whose date isn't one of the forms below is left out, never guessed. Pure.

export const accountTranscripts = (record: ChartRecord): ChartAccountTranscript[] =>
  (record.forms ?? []).filter(
    (f): f is ChartAccountTranscript => f?.type === "ACTR" && typeof f.year === "string",
  ) as ChartAccountTranscript[];

// "2027-04-15", "04-15-2027" or "04/15/2027" as MM-DD-YYYY; null for anything else.
function irsDate(date: string | null | undefined): string | null {
  const text = (date ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;
  const us = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(text);
  return us ? `${us[1]}-${us[2]}-${us[3]}` : null;
}

const money = (dollars: number) =>
  `${dollars < 0 ? "-" : ""}$${Math.abs(dollars).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function transcriptText(form: ChartAccountTranscript): string {
  const rows = (form.transactions ?? []).flatMap((t) => {
    const on = irsDate(t.date);
    if (!/^\d{3}$/.test(t.code) || !on || !Number.isFinite(t.amount)) return [];
    // The reader takes the code, the date and the amount; the words between are Jane's own.
    return [`${t.code} Transaction ${on} ${money(t.amount)}`];
  });
  const balance = form.account_summary?.account_balance;
  return [
    "Account Transcript",
    `TAX PERIOD: Dec. 31, ${form.year}`,
    ...(typeof balance === "number" && Number.isFinite(balance)
      ? [`ACCOUNT BALANCE: ${money(balance)}`]
      : []),
    "TRANSACTIONS",
    ...rows,
    "",
  ].join("\n");
}
