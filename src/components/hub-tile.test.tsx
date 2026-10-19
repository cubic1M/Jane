import { describe, expect, it } from "vitest";
import { HubTile, valueClass } from "./hub-tile";

// A tile's number wraps only between words, so a phone never shows "-$226,294.8" over "3".
describe("hub tile number", () => {
  it("never breaks inside a word", () => {
    expect(valueClass("$96,730.55")).toContain("[overflow-wrap:normal]");
    expect(valueClass("11 in 30 days")).toContain("[overflow-wrap:normal]");
  });

  it("is a size smaller for a long number, so two tiles fit across a phone", () => {
    expect(valueClass("-$226,294.83")).toMatch(/^text-base /);
    expect(valueClass("$73.00 a month")).toMatch(/^text-lg /);
    expect(valueClass("2")).toMatch(/^text-lg /);
  });

  it("uses it for the tile's number", () => {
    const tile = HubTile({
      tile: { label: "Net worth", href: "/net-worth", value: "-$226,294.83", status: "" },
    });
    const value = tile.props.children[1];
    expect(value.props).toMatchObject({ className: valueClass("-$226,294.83") });
  });
});
