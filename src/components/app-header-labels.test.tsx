import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/insurance" }));
vi.mock("@/components/demo-banner", () => ({ DemoBanner: () => null }));
vi.mock("@/components/scan-bar-gate", () => ({ ScanBarGate: () => null }));
vi.mock("@/components/back-to-chat", () => ({ BackToChat: () => null }));
vi.mock("@/components/profile-menu", () => ({ ProfileMenu: () => null }));
vi.mock("@/components/side-chat/side-chat", () => ({ SideChatUser: () => null }));

import { AppHeaderLoading } from "./app-header";

// The readable style (founder, 2026-11-18): the top bar says "Jane", not ">Jane", and the page
// you're on is its underlined tab, not "[Insurance]".
describe("the top bar's words", () => {
  const html = renderToStaticMarkup(<AppHeaderLoading />);
  const text = (h: string) => h.replace(/<[^>]+>/g, "");

  it("names Jane with no prompt mark", () => {
    const logo = /<span[^>]*select-none[^>]*>(.*?)<\/span>/.exec(html)?.[1] ?? "";
    expect(logo).toBe("Jane");
  });

  it("names the page you're on with no brackets", () => {
    const current = /<a[^>]*aria-current="page"[^>]*>(.*?)<\/a>/.exec(html)?.[1] ?? "";
    expect(text(current)).toBe("Insurance");
    expect(text(html)).not.toMatch(/[[\]]/);
  });
});
