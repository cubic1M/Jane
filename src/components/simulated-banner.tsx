import { SIMULATED_NOTICE } from "@/config/brokerage";

// On every screen that shows orders (spec step 133): until a real brokerage is connected,
// they're simulated and no real money moves.
export function SimulatedBanner() {
  return (
    <p
      role="note"
      data-simulated=""
      className="border-2 border-zinc-900 p-3 text-sm font-medium dark:border-zinc-100"
    >
      {SIMULATED_NOTICE}
    </p>
  );
}
