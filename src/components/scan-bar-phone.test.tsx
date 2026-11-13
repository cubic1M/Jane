import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ScanBar } from "./scan-bar";

// Debugger 11-13, a new student's first scan at 375: the bar's line was centred in a box that
// hides what doesn't fit, so on a phone it lost both ends ("░░] 71% · checking insurance, taxes,
// investi"). It starts from the left on a phone, and the label is cut at its end.

const html = renderToStaticMarkup(
  <ScanBar
    initial={{
      accounts: true,
      months: 12,
      transactions: true,
      detection: true,
      suggestions: false,
      done: false,
    }}
  />,
);

describe("the first scan's bar on a phone", () => {
  it("starts from the left, centring only from the small breakpoint up", () => {
    const bar = /<div[^>]*data-scan-bar[^>]*>/.exec(html)?.[0] ?? "";
    expect(bar).toMatch(/\bjustify-start\b/);
    expect(bar).toMatch(/\bsm:justify-center\b/);
    expect(bar).not.toMatch(/(^|\s|")justify-center\b/);
  });

  it("cuts the label at its end, not both sides", () => {
    expect(html).toMatch(/<span class="[^"]*\btruncate\b[^"]*">\[/);
  });
});
