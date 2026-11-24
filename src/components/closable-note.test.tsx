import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/home/actions", () => ({ closeBooksNote: vi.fn() }));

import { ClosableNote } from "./closable-note";

describe("a note with a close button", () => {
  it("has a labelled close button, at least a finger wide, when it has a key", () => {
    const html = renderToStaticMarkup(
      <ClosableNote closeKey="books_notice:0123456789abcdef" className="x">
        Some figures here rely on data I&apos;m still checking.
      </ClosableNote>,
    );
    expect(html).toContain('role="note"');
    expect(html).toContain('aria-label="Close this note"');
    expect(html).toContain("size-11");
    expect(html).toContain("Some figures here rely on data");
  });

  it("is just a note, no button, without one (the Net worth page's copy)", () => {
    const html = renderToStaticMarkup(<ClosableNote className="x">Some figures.</ClosableNote>);
    expect(html).toContain('role="note"');
    expect(html).not.toContain("<button");
  });
});
