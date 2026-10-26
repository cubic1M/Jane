import Link from "next/link";
import type { TaxSaving } from "@/planning/tax-savings";
import { SavingButtons } from "./saving-buttons";

// One saving's link and buttons, for its detail on the Taxes tree.
export function SavingActions({ saving: s, year }: { saving: TaxSaving; year: number }) {
  return (
    <>
      {s.action.kind === "link" && (
        <Link href={s.action.href} className="text-sm font-medium underline underline-offset-2">
          {s.action.label}
        </Link>
      )}
      <SavingButtons savingKey={s.key} year={year} kind={s.action.kind} />
    </>
  );
}
