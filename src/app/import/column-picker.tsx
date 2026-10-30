"use client";

import { useState } from "react";
import type { MappingChoices } from "@/data-sources/csv/column-mapping";

// For a CSV in no layout Jane knows: which column is the date, the description and the
// amount (or money out and money in). Jane's guesses for how dates are written and which sign
// is spending are shown for the person to check; when the file can't tell, they must say. The answers go with the form as map.<file>.<field>
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
  const { columns, guess, dateOrders, signs, markers } = choices;
  const [date, setDate] = useState(guess.date === null ? "" : String(guess.date));
  const [amount, setAmount] = useState(guess.amount === null ? "" : String(guess.amount));
  // Which way each amount went: by its sign, or by a column of its own (Debit/Credit, DR/CR).
  const [out, setOut] = useState<string>(guess.marker !== null ? "marked" : "");
  const [marker, setMarker] = useState(guess.marker === null ? "" : String(guess.marker));
  const markerColumn = marker === "" ? undefined : markers[Number(marker)];
  const name = (field: string) => `map.${index}.${field}`;
  const order = date === "" ? undefined : dateOrders[Number(date)];
  const sign = amount === "" ? undefined : signs[Number(amount)];

  const select = (
    field: string,
    label: string,
    initial: number | null,
    optional?: string,
    onChange?: (value: string) => void,
  ) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <select
        name={name(field)}
        defaultValue={initial === null ? "" : String(initial)}
        required={!optional}
        onChange={onChange && ((event) => onChange(event.target.value))}
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
        {select("date", "Date", guess.date, undefined, setDate)}
        {order && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Dates are written
            {/* Keyed by column, so a different date column starts from its own guess. */}
            <select
              key={date}
              name={name("dates")}
              defaultValue={order === "unknown" ? "" : order}
              required
              className={FIELD}
            >
              <option value="">Pick one</option>
              <option value="mdy">Month first (09/05/2026 is Sep 5)</option>
              <option value="dmy">Day first (05/09/2026 is 5 Sep)</option>
            </select>
            {order === "unknown" && (
              <span className="text-xs font-normal text-zinc-500">
                Jane can&apos;t tell from the dates in this file.
              </span>
            )}
          </label>
        )}
        {select("description", "Description", guess.description)}
        {select("balance", "Running balance (optional)", guess.balance, "None")}
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
            <select
              key={amount}
              name={name("out")}
              value={out || (guess.marker === null ? (sign?.moneyOut ?? "") : "marked")}
              onChange={(event) => setOut(event.target.value)}
              required
              className={FIELD}
            >
              <option value="">Pick one</option>
              <option value="negative">A negative number (-12.50)</option>
              <option value="positive">A positive number (12.50)</option>
              <option value="marked">Another column says (Debit/Credit, DR/CR)</option>
            </select>
            <span data-sign-guess="" className="text-xs font-normal text-zinc-500">
              {guess.marker !== null && (out === "" || out === "marked")
                ? "Jane's guess: the amounts have no sign, and another column says which way each went. Check the amounts in the preview."
                : sign?.moneyOut
                  ? `Jane's guess: ${sign.why.charAt(0).toLowerCase()}${sign.why.slice(1)}. Check the amounts in the preview.`
                  : "Jane can't tell from the rows. Check one you know, like a grocery shop."}
            </span>
          </label>
        )}
        {amount !== "" && (out === "marked" || (out === "" && guess.marker !== null)) && (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              The column that says which way
              <select
                name={name("marker")}
                value={marker}
                onChange={(event) => setMarker(event.target.value)}
                required
                className={FIELD}
              >
                <option value="">Pick a column</option>
                {columns.map((column, i) => (
                  <option key={i} value={i}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Money you spent is marked
              {/* Keyed by column, so a different column starts from its own guess. */}
              {markerColumn ? (
                <select
                  key={marker}
                  name={name("markout")}
                  defaultValue={markerColumn.out ?? ""}
                  required
                  className={FIELD}
                >
                  <option value="">Pick one</option>
                  {markerColumn.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  key={marker}
                  name={name("markout")}
                  placeholder="Debit"
                  required
                  className={FIELD}
                />
              )}
              <span className="text-xs font-normal text-zinc-500">
                Every other value in that column is money in.
              </span>
            </label>
          </>
        )}
      </div>
      <p className="text-xs text-zinc-500">Then press Preview again to check the rows.</p>
    </fieldset>
  );
}
