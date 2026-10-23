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
