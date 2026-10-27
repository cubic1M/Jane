"use client";

import { useState } from "react";
import type { MappingChoices } from "@/data-sources/csv/column-mapping";

// For a CSV in no layout Jane knows: which column is the date, the description and the
// amount (or money out and money in). The answers go with the form as map.<file>.<field>
// (mappingFromForm in column-mapping.ts reads them) when the person previews again.

const FIELD =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

type Props = {
  index: number;
  file: string;
  choices: MappingChoices;
  children: React.ReactNode;
};

export function ColumnPicker({ index, file, choices, children }: Props) {
  const { columns, guess } = choices;
  const [amount, setAmount] = useState(guess.amount === null ? "" : String(guess.amount));
  const name = (field: string) => `map.${index}.${field}`;

  const select = (field: string, label: string, initial: number | null, optional?: string) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <select
        name={name(field)}
        defaultValue={initial === null ? "" : String(initial)}
        required={!optional}
        className={FIELD}
      >
        <option value="">{optional ?? "Pick a column"}</option>
        {columns.map((column, i) => (
          <option key={i} value={i}>
            {column}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <fieldset
      data-column-picker=""
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <legend className="px-1 font-semibold">Which column is which in {file}?</legend>
      {children}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={name("header")} value="1" defaultChecked={choices.hasHeader} />
        The first row is column names
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {select("date", "Date", guess.date)}
        {select("description", "Description", guess.description)}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Amount
          <select
            name={name("amount")}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={FIELD}
          >
            <option value="">Separate money out and money in columns</option>
            {columns.map((column, i) => (
              <option key={i} value={i}>
                {column}
              </option>
            ))}
          </select>
        </label>
        {amount === "" ? (
          <>
            {select("debit", "Money out (debit)", guess.debit)}
            {select("credit", "Money in (credit)", guess.credit)}
          </>
        ) : (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Money you spent shows as
            <select name={name("out")} defaultValue="negative" className={FIELD}>
              <option value="negative">A negative number (-12.50)</option>
              <option value="positive">A positive number (12.50)</option>
            </select>
          </label>
        )}
      </div>
      <p className="text-xs text-zinc-500">Then press Preview again to check the rows.</p>
    </fieldset>
  );
}
