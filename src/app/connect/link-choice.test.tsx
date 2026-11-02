import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { LinkChoice } from "./link-choice";

const open = {
  plaidOn: true,
  uploadFirst: true,
  linkOpen: true,
  hasBanks: false,
  demoOn: false,
  primaryClassName: "primary",
};

const render = (over: Partial<typeof open> = {}) =>
  renderToStaticMarkup(<LinkChoice {...open} {...over} />);

describe("the offer to link a bank on /connect", () => {
  it("offers linking while there's a slot", () => {
    const html = render();
    expect(html).toContain("data-link-instead");
    expect(html).toContain("Link your bank");
    expect(html).not.toContain("data-link-full");
  });

  it("offers uploading a statement, in a short plain line, once there isn't", () => {
    const html = render({ linkOpen: false });
    expect(html).toContain("data-link-full");
    expect(html).toContain("Bank linking is full for now.");
    expect(html).toContain('href="/import"');
    expect(html).toContain("Upload a statement instead.");
    expect(html).not.toContain("data-link-instead");
    expect(html).not.toContain("<button");
  });

  it("offers the same to someone with a bank already: a second one falls back", () => {
    const html = render({ linkOpen: false, hasBanks: true });
    expect(html).toContain("Upload a statement instead.");
    expect(html).not.toContain("Link another bank");
  });

  it("shows trial people no upload, which they can't use: the demo bank stays below it", () => {
    expect(render({ uploadFirst: false, linkOpen: false, demoOn: true })).toBe("");
  });

  it("leaves things as they were for trial people outside Production", () => {
    expect(render({ uploadFirst: false, demoOn: true })).toContain("Link an account");
  });

  it("says linking isn't set up only where nothing else is offered", () => {
    expect(render({ plaidOn: false, uploadFirst: false })).toContain("isn&#x27;t set up yet");
    expect(render({ plaidOn: false })).toBe("");
    expect(render({ plaidOn: false, linkOpen: false })).toBe("");
  });
});
