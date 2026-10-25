import { describe, expect, it } from "vitest";
import { pageLinkTarget, type Tap } from "./nav-pending";

// Every link tap answers at once: the bar shows for a plain tap on a link to another page of
// this site, and never for a new tab, a download, another site or the page itself.

const here = new URL("https://jane.test/money?focus=coming");
const tap = (href: string | null, over: Partial<Tap> = {}): Tap => ({
  button: 0,
  modified: false,
  defaultPrevented: false,
  link: href === null ? null : { href, target: "", download: false },
  ...over,
});

describe("pageLinkTarget", () => {
  it("shows for a plain tap on another page of the site", () => {
    expect(pageLinkTarget(tap("/insurance"), here)?.pathname).toBe("/insurance");
    // The same page with other search params is another page to wait for.
    expect(pageLinkTarget(tap("/money?focus=budgets"), here)?.search).toBe("?focus=budgets");
    expect(pageLinkTarget(tap("https://jane.test/bills"), here)?.pathname).toBe("/bills");
  });

  it("stays out of the way of everything that doesn't load a page here", () => {
    expect(pageLinkTarget(tap(null), here)).toBeNull();
    expect(pageLinkTarget(tap("/money?focus=coming"), here)).toBeNull();
    expect(pageLinkTarget(tap("#yearly"), here)).toBeNull();
    expect(pageLinkTarget(tap("https://example.com/cancel"), here)).toBeNull();
    expect(pageLinkTarget(tap("/api/export"), here)).toBeNull();
    expect(pageLinkTarget(tap("/insurance", { modified: true }), here)).toBeNull();
    expect(pageLinkTarget(tap("/insurance", { button: 1 }), here)).toBeNull();
    expect(pageLinkTarget(tap("/insurance", { defaultPrevented: true }), here)).toBeNull();
    expect(
      pageLinkTarget(
        { ...tap(null), link: { href: "/x", target: "_blank", download: false } },
        here,
      ),
    ).toBeNull();
    expect(
      pageLinkTarget({ ...tap(null), link: { href: "/x", target: "", download: true } }, here),
    ).toBeNull();
  });
});
