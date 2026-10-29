import Link from "next/link";
import { hasDemoBank } from "@/lib/plaid/demo";
import { isTrialUser } from "@/lib/trial-ids";

// Shown on every signed-in page while a demo bank is linked (spec step 75), so fake data
// is never mistaken for real money.
export async function DemoBanner({ userId }: { userId: string }) {
  // Spec step 138: someone trying Jane is a sample person, gone after a day.
  if (isTrialUser(userId)) {
    return (
      <p
        role="note"
        className="w-full rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950 dark:bg-amber-900 dark:text-amber-50"
      >
        You&apos;re trying Jane with a sample person and fake data. Nothing contacts a real company,
        and it&apos;s all deleted after a day.{" "}
        <Link href="/signup" className="font-semibold underline">
          Sign up
        </Link>{" "}
        to use your own. Trying it means you agree to the{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    );
  }
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
