// What didn't add up in an upload's files (src/data-sources/csv/control-totals.ts), in the words
// the check wrote. The same lines wherever an upload's figures are shown.
export function ControlWarnings({ warnings }: { warnings: readonly string[] }) {
  return warnings.map((warning) => (
    <p
      key={warning}
      data-control-warning
      className="text-sm text-neutral-800 dark:text-neutral-200"
    >
      {warning}
    </p>
  ));
}
