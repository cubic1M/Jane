import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HeroView, SavedHero } from "@/lib/hub/view";
import { HeroRow } from "./hub";

// Founder 11-28: "remove safe to spend and money found, since that just does absolutely nothing."
// The hero row is the net worth, then the Saved tile once something is saved, and the plan's link.

const notSaved: SavedHero = {
  label: "Money found",
  cents: 290_000,
  perYear: true,
  share: 0,
  items: [],
  more: 0,
  confirmedCents: 0,
  expectedCents: 0,
};
const saved: SavedHero = {
  ...notSaved,
  label: "Saved so far",
  cents: 21_588,
  perYear: false,
  confirmedCents: 21_588,
};
const hero = (s: SavedHero): HeroView => ({ safe: null, netWorth: null, saved: s, plan: null });
const render = (s: SavedHero, planItems: number) =>
  renderToStaticMarkup(
    <HeroRow hero={hero(s)} planItems={planItems} chart={<p data-chart="">Net worth</p>} />,
  );

describe("the home hero row", () => {
  it("shows no Safe to spend or Money found tile, whatever there is to find", () => {
    for (const planItems of [0, 3]) {
      const html = render(notSaved, planItems);
      expect(html).not.toMatch(/safe[ -]to[ -]spend|money[ -]found|data-hub-tile="safe"/i);
      expect(html).not.toContain('data-hub-tile="saved"');
      expect(html).toContain("Net worth");
    }
  });

  it("leaves no empty tile behind when nothing is saved and there is no plan", () => {
    const html = render(notSaved, 0);
    expect(html).not.toContain("data-hub-tile");
  });

  it("keeps the plan's link, standing alone, when nothing is saved yet", () => {
    const html = render(notSaved, 3);
    expect(html).toContain("Your plan: 3 things");
    expect(html).not.toContain('data-hub-tile="saved"');
  });

  it("still shows Saved so far once something is saved", () => {
    const html = render(saved, 0);
    expect(html).toContain('data-hub-tile="saved"');
    expect(html).toContain("Saved so far");
  });
});
