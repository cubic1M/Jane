import type { BooksView } from "@/lib/books";

// Where each books problem gets fixed (spec step 238), for the notice on Home and Net worth and
// for Jane's chat message: an import that ended needs a newer file, a lapsed sign-in needs
// Reconnect, a transfer to an account Jane can't see needs that account linked, and the rest
// (a balance that doesn't add up, a link that stopped updating, an account linked twice) are
// the bank's, with Refresh and Disconnect, in Settings.

type Issue = Pick<BooksView["open"][number], "kind" | "accountId" | "itemId">;

export type BooksFix = { label: string; href: string };

// An imported account's file ended (real-user QA): it has an account and no bank link.
export const importEnded = (issue: Issue) =>
  issue.kind === "stale" && issue.accountId !== null && issue.itemId === null;

export function booksFix(issue: Issue): BooksFix {
  if (importEnded(issue)) return { label: "Import a newer file", href: "/import" };
  if (issue.kind === "broken") return { label: "Reconnect", href: "/connect" };
  if (issue.kind === "transfer") return { label: "Link that account", href: "/connect" };
  return { label: "Check my linked banks", href: "/settings#banks" };
}
