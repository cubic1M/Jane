import type { PersonId } from "@/config/people";
import type { FactKey } from "@/profile/facts";

// Things the sample people have told Jane that no bank shows (detector coverage), seeded into the
// database when their demo bank first syncs (src/lib/plaid/demo-investing.ts) and read by the
// detector harness (src/profile/sample.ts), so the two never disagree.

// Facts they answered, by the day they're asked about (a year counts back from it).
export function demoToldFor(
  person: string,
  today: string,
): Partial<Record<FactKey, string | number | boolean>> {
  const year = Number(today.slice(0, 4));
  switch (person as PersonId) {
    // Ruth's sister died ten years ago, so the inherited IRA has to be empty by this December 31.
    case "retiree":
      return { inherited_ira_death_year: year - 10 };
    default:
      return {};
  }
}

// Credit they help family with (spec step 249): Dan and Lena co-signed their daughter Emily's
// car loan when she started work.
export type DemoFamilyCredit = {
  kind: "cosigned";
  person: string;
  balanceCents: number;
  monthlyPaymentCents: number;
  missed: boolean;
};
export const DEMO_FAMILY_CREDIT: Partial<Record<PersonId, readonly DemoFamilyCredit[]>> = {
  preretire: [
    {
      kind: "cosigned",
      person: "Emily",
      balanceCents: 1_460_000,
      monthlyPaymentCents: 32_400,
      missed: false,
    },
  ],
};
