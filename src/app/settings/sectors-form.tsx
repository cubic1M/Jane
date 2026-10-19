"use client";

import { useActionState } from "react";
import { SECTOR_LEVEL_LABELS, SECTOR_LEVELS } from "@/config/autopilot-sectors";
import { saveSector, type SectorState } from "./sector-actions";

const FIELD =
  "h-10 rounded-lg border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700";

export type SectorRow = {
  sector: string;
  label: string;
  level: string;
  actionCap: string;
  monthlyCap: string;
  used: string;
  allMeans: string;
};

function SectorForm({ row }: { row: SectorRow }) {
  const [state, action, pending] = useActionState<SectorState, FormData>(saveSector, null);
  return (
    <form
      action={action}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <input type="hidden" name="sector" value={row.sector} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{row.label}</span>
        <span className="text-xs text-zinc-500">Used this month: {row.used}</span>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          How much Jane may do
          <select name="level" defaultValue={row.level} className={FIELD}>
            {SECTOR_LEVELS.map((l) => (
              <option key={l} value={l}>
                {SECTOR_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Up to, each time ($)
          <input
            name="actionCap"
            inputMode="decimal"
            defaultValue={row.actionCap}
            className={`${FIELD} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1">
          Up to, each month ($)
          <input
            name="monthlyCap"
            inputMode="decimal"
            defaultValue={row.monthlyCap}
            className={`${FIELD} w-28`}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-full bg-emerald-700 px-4 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          Save
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Everything allowed lets Jane {row.allMeans}. Anything over a cap, she asks.
      </p>
      {state && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

// One autopilot, every sector (spec step 141).
export function SectorsForm({ rows }: { rows: SectorRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <SectorForm key={row.sector} row={row} />
      ))}
    </div>
  );
}
