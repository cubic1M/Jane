import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FloatingCardData } from "@/lib/floating-cards";
import { FloatingCards } from "./floating-cards";

// Debug 2 (11-15, 1280 light): a heads-up card in the dock, opened, read "Your costly borrowing ›"
// in its details right above its main button, "Your costly borrowing": the message's first link
// is the card's Yes (popupCard), and the details listed every link again. The page the main
// button opens isn't listed again; other pages still are.

const card: FloatingCardData = {
  id: "a",
  headline: "Costly short-term borrowing cost you $90.00 over the last year.",
  details: { about: "There are cheaper ways out." },
  yesHref: "/loans/costly",
  yesLabel: "Your costly borrowing",
  notNowLabel: "Remind me later",
  noNever: true,
};

const draw = (links: Record<string, { label: string; href: string }[]>) =>
  renderToStaticMarkup(
    <FloatingCards cards={[card]} label="Suggestions for you" links={links} onAnswer={vi.fn()} />,
  );

describe("a card's main button and its details' links", () => {
  it("doesn't list the main button's page again in the details", () => {
    const html = draw({ a: [{ label: "Your costly borrowing", href: "/loans/costly" }] });
    expect(html.match(/href="\/loans\/costly"/g)).toHaveLength(1);
    expect(html).not.toContain("Your costly borrowing ›");
  });

  it("still lists another page", () => {
    const html = draw({
      a: [
        { label: "Your costly borrowing", href: "/loans/costly" },
        { label: "Your bank fees", href: "/insights" },
      ],
    });
    expect(html).toContain('href="/insights"');
  });
});
