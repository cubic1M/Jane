import { SIMULATED_NOTICE } from "@/config/brokerage";

// On every screen that shows orders (spec step 133): until a real brokerage is connected,
// they're simulated and no real money moves.
export function SimulatedBanner() {
  return (
    <p
      role="note"
      data-simulated=""
      className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm font-medium text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
    >
      {SIMULATED_NOTICE}
    </p>
  );
}
