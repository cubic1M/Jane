import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShareCardArt } from "@/components/share-card-art";
import { SHARE_MIN_FOUND_CENTS } from "@/config/share";
import {
  cardFor,
  cardFromQuery,
  cardFromRow,
  cardHeadline,
  cardImagePath,
  cardLines,
  roundFoundCents,
} from "./share-card";

describe("roundFoundCents", () => {
  it("rounds down to $10, then $50, then $100, so no exact figure shows", () => {
    expect(roundFoundCents(123_45)).toBe(120_00);
    expect(roundFoundCents(999_99)).toBe(990_00);
    expect(roundFoundCents(1_234_56)).toBe(1_200_00);
    expect(roundFoundCents(4_999_99)).toBe(4_950_00);
    expect(roundFoundCents(12_345_67)).toBe(12_300_00);
  });
});

describe("cardFor", () => {
  it("says what Jane found, rounded, from the threshold up", () => {
    expect(cardFor({ foundCents: 1_234_56, checks: 9 })).toEqual({ kind: "found", dollars: 1200 });
    expect(cardFor({ foundCents: SHARE_MIN_FOUND_CENTS, checks: 0 })?.kind).toBe("found");
  });

  it("says how many things Jane checked when there's little to save", () => {
    expect(cardFor({ foundCents: SHARE_MIN_FOUND_CENTS - 1, checks: 9 })).toEqual({
      kind: "checked",
      checks: 9,
    });
    expect(cardFor({ foundCents: 0, checks: 1 })).toEqual({ kind: "checked", checks: 1 });
  });

  it("has nothing to share with no findings and no checkup", () => {
    expect(cardFor({ foundCents: 0, checks: 0 })).toBeNull();
  });
});

describe("the card's words", () => {
  it("reads as one line", () => {
    expect(cardHeadline({ kind: "found", dollars: 1200 })).toBe("Jane found me $1,200/yr");
    expect(cardHeadline({ kind: "checked", checks: 9 })).toBe(
      "Jane checked 9 things. I'm in good shape.",
    );
    expect(cardHeadline({ kind: "checked", checks: 1 })).toBe(
      "Jane checked 1 thing. I'm in good shape.",
    );
    expect(cardLines({ kind: "found", dollars: 1200 })).toEqual({
      small: "Jane found me",
      big: "$1,200/yr",
    });
  });

  it("points at the image with only the kind and number", () => {
    expect(cardImagePath({ kind: "found", dollars: 1200 })).toBe(
      "/api/share/card?kind=found&value=1200",
    );
    expect(cardImagePath({ kind: "checked", checks: 9 })).toBe(
      "/api/share/card?kind=checked&value=9",
    );
  });
});

describe("reading a card back", () => {
  it("takes only the two kinds with a positive whole number", () => {
    expect(cardFromRow("found", 1200)).toEqual({ kind: "found", dollars: 1200 });
    expect(cardFromRow("checked", 9)).toEqual({ kind: "checked", checks: 9 });
    expect(cardFromRow("found", 0)).toBeNull();
    expect(cardFromRow("found", null)).toBeNull();
    expect(cardFromRow("balance", 5000)).toBeNull();
    expect(cardFromRow(null, 5)).toBeNull();
  });

  it("refuses anything in the image query but digits", () => {
    expect(cardFromQuery("found", "1200")).toEqual({ kind: "found", dollars: 1200 });
    expect(cardFromQuery("found", "12.5")).toBeNull();
    expect(cardFromQuery("found", "Netflix")).toBeNull();
    expect(cardFromQuery("found", "1e9")).toBeNull();
    expect(cardFromQuery("found", "123456789")).toBeNull();
    expect(cardFromQuery("checked", null)).toBeNull();
  });
});

// The privacy rule: the drawn card is the two lines and Jane's own words. Whatever the person
// has (merchants, accounts, balances, a name), there is no way in.
describe("the drawn card", () => {
  const JANE_WORDS = ["[JANE]", "An AI financial controller · invite-only beta"];

  it.each([
    { kind: "found" as const, dollars: 1200 },
    { kind: "checked" as const, checks: 9 },
  ])("shows only its lines and Jane's words: %o", (card) => {
    const text = renderToStaticMarkup(<ShareCardArt card={card} />)
      .replace(/<[^>]+>/g, "\n")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const { small, big } = cardLines(card);
    expect(text.sort()).toEqual(
      [small, big, ...JANE_WORDS].map((s) => s.replace("'", "&#x27;")).sort(),
    );
  });

  it("falls back to Jane's plain card with no card", () => {
    const html = renderToStaticMarkup(<ShareCardArt card={null} />);
    expect(html).toContain("Meet Jane");
    expect(html).not.toMatch(/\$\d/);
  });
});
