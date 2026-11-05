import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { STILL_LOADING_SELECTOR } from "@/config/page-cache";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { ScanningProgress } from "./scanning-progress";

// Debugger 11-05: link a bank, the scan, then back on /connect for good. Home, with no bank yet, sends
// someone to /connect, and a round of preloads started on this page kept that answer for the hand-off.
describe("the first scan's page", () => {
  it("is one that holds a round of preloads back", () => {
    const html = renderToStaticMarkup(<ScanningProgress next="/home" />);
    const marks = [...STILL_LOADING_SELECTOR.matchAll(/\[([a-z-]+)\]/g)].map((m) => m[1]);
    expect(marks.filter((mark) => html.includes(mark))).not.toEqual([]);
  });
});
