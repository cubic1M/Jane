import type { ReactNode } from "react";

// The green line a page shows after a save or a change: "Saved.", "Rental added."
export function DoneBanner({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
    >
      {children}
    </p>
  );
}
