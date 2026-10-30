import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/insurance" }));
// The real header's server parts, which the loading one doesn't use.
vi.mock("@/components/demo-banner", () => ({ DemoBanner: () => null }));
vi.mock("@/components/scan-bar-gate", () => ({ ScanBarGate: () => null }));
vi.mock("@/components/back-to-chat", () => ({ BackToChat: () => null }));
vi.mock("@/components/profile-menu", () => ({ ProfileMenu: () => null }));
vi.mock("@/components/side-chat/side-chat", () => ({ SideChatUser: () => null }));

import { AppHeaderLoading } from "./app-header";

// While a page streams in, its loading header and its real one are both in the document for a
// moment (e2e/logo.spec.ts found two #app-top-bar). The loading one makes the same room for the
// page, but it isn't the page's bar or logo.
describe("the top bar while a page loads", () => {
  const html = renderToStaticMarkup(<AppHeaderLoading />);

  it("keeps the page's room, as the real bar does", () => {
    expect(html).toContain('data-app-top-bar=""');
  });

  it("never takes the real bar's id or the logo's mark", () => {
    expect(html).not.toContain('id="app-top-bar"');
    expect(html).not.toContain("data-jane-logo");
    expect(html).toContain("Jane");
  });
});
