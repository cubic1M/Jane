// What the keys page says about the press just made (docs/security/keys.md).

export type Search = {
  rotated?: string;
  failed?: string;
  done?: string;
  error?: string;
  // Where a run that ran out of time got to.
  at?: string;
};

// What the page's own report finds off the current key: `behind` on an older key that is set up,
// `stuck` under a missing key or unreadable. A press that carried on from an earlier one doesn't go
// back to what failed before it, so "everything" is said only when both are none; the next press
// starts from the beginning.
export function LastRun({
  search,
  behind,
  stuck,
}: {
  search: Search;
  behind: number;
  stuck: number;
}) {
  if (search.error === "record") {
    return (
      <p className="rounded-xl border-2 border-zinc-900 p-3 text-sm font-semibold dark:border-zinc-100">
        Nothing was changed: the run couldn&apos;t be written to the audit log. Press the button
        again.
      </p>
    );
  }
  if (search.error) {
    return (
      <p className="rounded-xl border-2 border-zinc-900 p-3 text-sm font-semibold dark:border-zinc-100">
        Nothing was changed: the current key isn&apos;t working. Fix the problems listed below,
        redeploy, then press the button again.
      </p>
    );
  }
  if (search.rotated === undefined) return null;
  const failed = Number(search.failed ?? 0);
  const count = (n: number) => (n === 1 ? "1 value" : `${n} values`);
  const reached =
    behind > 0
      ? `It reached the end, but ${count(behind)} ${behind === 1 ? "is" : "are"} still on an older key: press it again to try from the start.`
      : stuck > 0
        ? `It went through everything it can read; ${count(stuck)} can't be read (see Keys above).`
        : "It went through everything.";
  return (
    <p className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      Last run moved {search.rotated} values to the current key.
      {failed > 0 && ` ${failed} couldn't be moved (their key is missing or wrong).`}{" "}
      {search.done === "1" ? reached : "It ran out of time: press it again."}
    </p>
  );
}
