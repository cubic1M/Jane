import { normalizeMerchant } from "@/data-sources/merchant";
import { formatCents } from "@/lib/money";
import type { ShareableCharge } from "@/lib/shared-bills";
import { settle, split, unsplit } from "./actions";

const BUTTON =
  "rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Shared bills: the balance between the two of you, charges on shared accounts to split,
// and the ones already split.
export function SharedBills({
  partnerEmail,
  owedToMeCents,
  charges,
  split: splitIds,
  myShareBps,
}: {
  partnerEmail: string;
  owedToMeCents: number;
  charges: ShareableCharge[];
  // Charge id -> shared charge id, for the ones already split.
  split: Map<string, { sharedChargeId: string; partnerShareBps: number }>;
  // Spec step 242: my share of a shared bill under the household's rule (half, or by income).
  myShareBps: number;
}) {
  // What the one who didn't pay owes, in percent.
  const owed = (mine: boolean) => Math.round((mine ? 10_000 - myShareBps : myShareBps) / 100);
  const name = (c: ShareableCharge) =>
    c.merchant ?? normalizeMerchant(c.description)?.name ?? c.description;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800">
      <h2 className="font-semibold">Shared bills</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg">
          {owedToMeCents === 0
            ? "You're all square."
            : owedToMeCents > 0
              ? `${partnerEmail} owes you ${formatCents(owedToMeCents)}`
              : `You owe ${partnerEmail} ${formatCents(-owedToMeCents)}`}
        </p>
        {owedToMeCents !== 0 && (
          <form action={settle}>
            <button type="submit" className={BUTTON}>
              Settle up
            </button>
          </form>
        )}
      </div>
      {charges.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No recent charges on shared accounts. Share an account above to split its bills.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          {charges.map((c) => {
            const done = splitIds.get(c.id);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span className="font-medium">{name(c)}</span>
                  <span className="text-xs text-zinc-500">
                    {c.date} · {formatCents(c.amountCents)} · paid by{" "}
                    {c.mine ? "you" : partnerEmail}
                    {done
                      ? ` · split ${100 - done.partnerShareBps / 100}/${done.partnerShareBps / 100}`
                      : ""}
                  </span>
                </span>
                {done ? (
                  <form action={unsplit}>
                    <input type="hidden" name="sharedChargeId" value={done.sharedChargeId} />
                    <button type="submit" className={BUTTON}>
                      Undo split
                      <span className="sr-only">
                        {" "}
                        of {name(c)} on {c.date}
                      </span>
                    </button>
                  </form>
                ) : (
                  <form action={split}>
                    <input type="hidden" name="transactionId" value={c.id} />
                    <input type="hidden" name="percent" value={String(owed(c.mine))} />
                    <button type="submit" className={BUTTON}>
                      {owed(c.mine) === 50
                        ? "Split half"
                        : `Split ${100 - owed(c.mine)}/${owed(c.mine)}`}
                      <span className="sr-only">
                        {" "}
                        of {name(c)} on {c.date}
                      </span>
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
