import { ASSUMPTIONS } from "@/config/market-assumptions";

// The assumptions behind an investment projection (spec steps 130–137), with their sources,
// shown under every range so nothing reads as a promise.
export function Assumptions({
  extra = [],
}: {
  extra?: { label: string; value: string; source: string }[];
}) {
  const rows = [
    ...ASSUMPTIONS.map((a) => ({
      label: a.label,
      value: `${(a.value * 100).toFixed(1).replace(/\.0$/, "")}% a year`,
      source: a.source,
    })),
    ...extra,
  ];
  return (
    <details className="text-xs text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer font-medium">
        How this is worked out: a range, not a promise
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label}>
            <strong>{r.label}:</strong> {r.value}. {r.source}.
          </li>
        ))}
      </ul>
    </details>
  );
}
