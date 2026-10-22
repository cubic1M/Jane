import type { BooksView } from "@/lib/books";
import type { Reply } from "./replies";

// "Are my numbers right?" (spec step 238): what Jane checks every day, and what doesn't add
// up yet, in words.
export function booksReply(books: BooksView): Reply {
  const open = books.open.filter((o) => o.kind !== "transfer");
  if (open.length === 0) {
    return {
      body: "Yes, as far as I can tell. Each day I check that your balances agree with your transactions, that no account is linked twice and that your bank links are up to date, and everything adds up.",
      actions: [],
      refs: {},
    };
  }
  return {
    body: `Not everything adds up yet. ${open.map((o) => o.words).join(" ")} Figures that rely on these are marked until they're fixed.`,
    actions: [{ id: "open", label: "Check my accounts", kind: "link", href: "/connect" }],
    refs: {},
  };
}
