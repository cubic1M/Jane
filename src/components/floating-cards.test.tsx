import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OptionSet } from "@/lib/floating-cards";
import { FloatingCards } from "./floating-cards";

// The generic floating cards in "pick" mode: options of one choice, each with a one-line
// summary and its details already on the page.

const set: OptionSet = {
  title: "Car insurance quotes",
  options: [
    {
      id: "lighthouse",
      headline: "Switch to Lighthouse, save $408/yr",
      summary: "Cheapest, same cover and deductible.",
      details: {
        why: "You pay $1,704.00 a year now.",
        figures: [{ label: "Lighthouse", value: "$1,296.00 a year" }],
        confidence: { percent: 82, reason: "a same-cover quote" },
        whatYesDoes: "Jane switches you; your old policy stays until the new one starts.",
      },
      yesLabel: "Pick this one",
    },
    {
      id: "harbor",
      headline: "Switch to Harbor, save $170/yr",
      summary: "Cheaper, but a $1,000 deductible.",
      details: {},
      yesLabel: "Pick this one",
    },
  ],
};

describe("options of one choice", () => {
  const html = renderToStaticMarkup(
    <FloatingCards cards={set.options} mode="pick" label={set.title} onAnswer={vi.fn()} />,
  );

  it("shows the first option with its summary, counted through the set", () => {
    expect(html).toContain('data-floating-cards="pick"');
    expect(html).toContain("1 of 2");
    expect(html).toContain("Switch to Lighthouse, save $408/yr");
    expect(html).toContain("Cheapest, same cover and deductible.");
    expect(html).toContain("Pick this one");
    expect(html).not.toContain("Switch to Harbor");
  });

  it("has the figures, the confidence and what Yes does ready behind More details", () => {
    expect(html).toContain("More details");
    expect(html).toContain("$1,296.00 a year");
    expect(html).toContain("82% sure:");
    expect(html).toContain("What Yes does:");
  });

  it("is nothing with no options", () => {
    expect(
      renderToStaticMarkup(<FloatingCards cards={[]} mode="pick" label="x" onAnswer={vi.fn()} />),
    ).toBe("");
  });
});

describe("the confidence line", () => {
  const card = (reason: string) =>
    renderToStaticMarkup(
      <FloatingCards
        cards={[
          {
            id: "c",
            headline: "A card",
            details: { confidence: { percent: 35, reason } },
            yesLabel: "Yes",
          },
        ]}
        mode="pick"
        label="Cards"
        onAnswer={vi.fn()}
      />,
    );
  it("ends the reason with one full stop, whether or not it came with one", () => {
    expect(card("thin evidence")).toContain("thin evidence.");
    // The practice scan's reasons end with a full stop already: no ". ." after them.
    const html = card("One headline is thin evidence, so the position is kept small.");
    expect(html).toContain("kept small.");
    expect(html).not.toContain("kept small..");
  });
});

// Compact pop-ups (docs/design/home-hub.md): shut, a suggestion is an icon, the headline and
// Yes and Not now, with the cards behind it as "+2"; the details wait behind the chevron.
describe("a line of suggestions", () => {
  const card = (id: string, headline: string) => ({
    id,
    headline,
    details: {
      why: "No plays since June.",
      confidence: { percent: 90, reason: "8 months of charges" },
      whatYesDoes: "I ask the team to cancel it.",
    },
    yesLabel: "Yes",
  });
  const html = renderToStaticMarkup(
    <FloatingCards
      cards={[
        card("a", "Cancel Hulu, save $215/yr"),
        card("b", "Drop PMI, save $1,562/yr"),
        card("c", "Move idle cash, earn $400/yr"),
      ]}
      label="Suggestions for you"
      onAnswer={vi.fn()}
    />,
  );

  it("shows one card, shut, with the rest counted behind it", () => {
    expect(html).toContain("Cancel Hulu, save $215/yr");
    expect(html).not.toContain("Drop PMI");
    expect(html).toContain("+2");
    // Screen readers hear how many are left.
    expect(html).toContain("3 left");
    expect(html).toContain('aria-label="More details"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("keeps the details on the page, hidden until the chevron opens them", () => {
    expect(html).toMatch(/<div[^>]*id="details-a"[^>]*hidden=""/);
    expect(html).toContain("90% sure:");
    expect(html).toContain("What Yes does:");
  });

  it("has Yes and Not now, and nothing else to tap while shut", () => {
    expect(html).toContain(">Yes<");
    expect(html).toContain(">Not now<");
    expect(html).not.toContain("✕");
  });
});

// A card that will fold on a phone isn't painted full size first (it was Home's last layout
// shift): the server's HTML keeps it out of sight on a small screen until the page has hydrated.
describe("a card that folds on a phone", () => {
  const render = (foldOnPhone: boolean) =>
    renderToStaticMarkup(
      <FloatingCards
        cards={set.options}
        mode="pick"
        label={set.title}
        onAnswer={vi.fn()}
        foldOnPhone={foldOnPhone}
      />,
    );

  it("is hidden on a small screen in the first HTML", () => {
    expect(render(true)).toContain("max-sm:hidden");
  });

  it("is not hidden where it never folds", () => {
    expect(render(false)).not.toContain("max-sm:hidden");
  });
});
