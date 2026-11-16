import Link from "next/link";

// Where to go from the month's bills (gate A, the dead-end crawl, 11-15: a list of charges with
// nothing to press). Each is a regular charge Jane tracks; reviewing or cancelling one is on
// Subscriptions.
export function BillsOnward() {
  return (
    <Link
      href="/subscriptions"
      className="self-start text-sm font-medium underline underline-offset-2 hover:no-underline"
    >
      Review your regular charges ›
    </Link>
  );
}
