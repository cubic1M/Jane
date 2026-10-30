import type { CashIncomeStatus } from "@/categorize/cash-income";
import { SubmitButton } from "@/components/submit-button";
import { countAsIncome, notIncome } from "./actions";

// Under the month chart: cash deposits that come back regularly count as income, and how sure
// Jane is; the person can say they aren't income, and take that back.
const BUTTON = "font-medium underline underline-offset-2 hover:no-underline";

export function CashIncomeNote({ status }: { status: CashIncomeStatus }) {
  return (
    <form
      action={status.counted ? notIncome : countAsIncome}
      data-cash-income=""
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400"
    >
      <span>
        {status.counted
          ? `Cash deposits, counted as income (${status.percent}% sure)`
          : "Cash deposits, not counted as income"}
      </span>
      <SubmitButton className={BUTTON}>
        {status.counted ? "Not income" : "Count as income"}
      </SubmitButton>
    </form>
  );
}
