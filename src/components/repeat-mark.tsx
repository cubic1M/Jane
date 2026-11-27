import Link from "next/link";
import { Blinded } from "@/components/hub/blinded";
import { formatCents } from "@/lib/money";
import type { RepeatMark as Mark } from "@/lib/recurring-marks";

// The small mark on a spending row that repeats (src/lib/recurring-marks.ts): a repeat glyph and
// "Subscription · monthly" or "Repeats monthly", linking to the charge on /subscriptions. It
// sits under the name and wraps there, so it never pushes the amount off the row. `withAmount`
// adds the charge's own amount, for a merchant row whose figure is a total; `hidden` stands the
// dots in for it where figures are hidden.

function Glyph() {
  // Two arrows chasing each other; the words beside it say what it means.
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 7a5.5 5.5 0 0 1 9.4-3.2L13.5 5.5" />
      <path d="M13.5 2.5v3h-3" />
      <path d="M13.5 9a5.5 5.5 0 0 1-9.4 3.2L2.5 10.5" />
      <path d="M2.5 13.5v-3h3" />
    </svg>
  );
}

export function RepeatMark({
  mark,
  withAmount = false,
  hidden = false,
}: {
  mark: Mark;
  withAmount?: boolean;
  hidden?: boolean;
}) {
  return (
    <Link
      href={mark.href}
      prefetch={false}
      data-repeat-mark={mark.kind}
      className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 self-start rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
    >
      <Glyph />
      <span>{mark.label}</span>
      {withAmount && (
        <span className="tabular-nums">
          · {hidden ? <Blinded /> : formatCents(mark.amountCents)}
        </span>
      )}
    </Link>
  );
}
