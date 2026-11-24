import { describe, expect, it } from "vitest";
import type { BooksView } from "./books";
import { booksNoticeKey, worryingBooks } from "./books-notice";

// The box on Home that says some figures rely on data Jane is still checking (founder 11-24): once
// closed, it stays closed until the problems it names change, so its key is the set of problems.

const open = (id: string, kind = "gap", itemId: string | null = null) => ({
  id,
  kind,
  label: kind,
  words: `${kind} ${id}`,
  accountId: null,
  itemId,
  uploaded: false,
});
const books = (...rows: ReturnType<typeof open>[]): BooksView => ({
  open: rows,
  markedAccountIds: [],
  merged: 0,
});

describe("the problems the box names", () => {
  it("leaves out transfers, and banks whose trouble Home says elsewhere", () => {
    const view = books(open("a"), open("b", "transfer"), open("c", "stale", "bank-1"));
    expect(worryingBooks(view).map((o) => o.id)).toEqual(["a", "c"]);
    expect(worryingBooks(view, ["bank-1"]).map((o) => o.id)).toEqual(["a"]);
  });
});

describe("the key a closed box is remembered by", () => {
  it("is the same for the same problems, in any order", () => {
    expect(booksNoticeKey(["a", "b"])).toBe(booksNoticeKey(["b", "a"]));
    expect(booksNoticeKey(["a", "b"])).toMatch(/^books_notice:[0-9a-f]{16}$/);
  });

  it("changes when a problem is fixed or a new one is found, so the box comes back", () => {
    expect(booksNoticeKey(["a"])).not.toBe(booksNoticeKey(["a", "b"]));
    expect(booksNoticeKey(["a", "b"])).not.toBe(booksNoticeKey(["a", "c"]));
  });
});
