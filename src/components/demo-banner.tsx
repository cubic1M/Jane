import Link from "next/link";
import { StartOverButton } from "@/components/start-over-button";
import { TRIAL_DELETED_WITHIN_HOURS } from "@/config/statement-trial";
import { hasDemoBank } from "@/lib/plaid/demo";
import { isStatementTrialUser, isTrialUser } from "@/lib/trial-ids";

const BANNER =
  "w-full rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950 dark:bg-amber-900 dark:text-amber-50";

// Shown on every signed-in page while a demo bank is linked (spec step 75), so fake data
// is never mistaken for real money.
export async function DemoBanner({ userId }: { userId: string }) {
  // Someone's own statement, in a temporary person: real numbers, so nothing here says sample.
  if (isStatementTrialUser(userId)) {
    return (
      <p role="note" data-temporary-try="" className={BANNER}>
        This is temporary, and it&apos;s your own statement. There&apos;s no account, and everything
        is deleted when you start over, or within {TRIAL_DELETED_WITHIN_HOURS} hours.{" "}
        <StartOverButton />
      </p>
    );
  }
  // Spec step 138: someone trying Jane is a sample person, gone after a day.
  if (isTrialUser(userId)) {
    return (
      <p role="note" className={BANNER}>
        You&apos;re trying Jane with a sample person and fake data. Nothing contacts a real company,
        and it&apos;s all deleted after a day.{" "}
        <Link href="/signup" className="font-semibold underline">
          Sign up
        </Link>{" "}
        to use your own.
      </p>
    );
  }
  if (!(await hasDemoBank(userId))) return null;
  return (
    <p role="note" className={BANNER}>
      You&apos;re looking at a demo bank with fake data.{" "}
      <Link href="/settings#banks" className="font-semibold underline">
        Remove it
      </Link>{" "}
      anytime.
    </p>
  );
}
