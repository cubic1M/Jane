import Link from "next/link";
import { hasDemoBank } from "@/lib/plaid/demo";

// Shown on every signed-in page while a demo bank is linked (spec step 75), so fake data
// is never mistaken for real money.
export async function DemoBanner({ userId }: { userId: string }) {
  if (!(await hasDemoBank(userId))) return null;
  return (
    <p
      role="note"
      className="w-full rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950 dark:bg-amber-900 dark:text-amber-50"
    >
      You&apos;re looking at a demo bank with fake data.{" "}
      <Link href="/settings#banks" className="font-semibold underline">
        Remove it
      </Link>{" "}
      anytime.
    </p>
  );
}
