import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FloatingCardData } from "@/lib/floating-cards";
import { FloatingCards } from "./floating-cards";

// Founder (11-12): opening a card's details or its page never takes the card away. A main button
// that only leads to details is a button that opens them in the card, not a link to a page; a
// page link stays a link; and in the open details a link to the same details isn't repeated.

const card = (over: Partial<FloatingCardData>): FloatingCardData => ({
  id: "a",
  headline: "Your home's property tax went up $412",
  details: { about: "The county's new bill is $5,212.00, up from $4,800.00." },
  yesLabel: "Yes",
  notNowLabel: "Not now",
  noNever: true,
  ...over,
});
const draw = (c: FloatingCardData, links?: Record<string, { label: string; href: string }[]>) =>
  renderToStaticMarkup(
    <FloatingCards cards={[c]} label="Suggestions for you" links={links} onAnswer={vi.fn()} />,
  );

describe("a card's links", () => {
  it("opens its details in the card when the main button only leads to them", () => {
    const html = draw(card({ yesHref: "/home/property-tax", yesLabel: "See the details" }));
    expect(html).toMatch(/<button[^>]*aria-controls="details-a"[^>]*>See the details<\/button>/);
    expect(html).not.toContain('href="/home/property-tax"');
    // Not now is still there to answer it.
    expect(html).toContain(">Not now<");
  });

  it("goes to the page when the main button leads somewhere", () => {
    const html = draw(card({ yesHref: "/insurance", yesLabel: "See your insurance" }));
    expect(html).toMatch(/<a[^>]*href="\/insurance"[^>]*>See your insurance<\/a>/);
  });

  it("lists page links in the details, never one back to the same details", () => {
    const html = draw(card({}), {
      a: [
        { label: "Open", href: "/subscriptions?from=a" },
        { label: "See the details", href: "/home/property-tax?from=a" },
      ],
    });
    expect(html).toContain('href="/subscriptions?from=a"');
    expect(html).not.toContain("/home/property-tax");
  });
});
