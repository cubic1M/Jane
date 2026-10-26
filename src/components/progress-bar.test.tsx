import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("is a labelled progressbar filled to the percent", () => {
    const html = renderToStaticMarkup(<ProgressBar label="Food budget used" percent={40} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Food budget used"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain("width:40%");
    expect(html).toContain("bg-emerald-600");
    expect(html).toContain('class="h-2 overflow-hidden');
  });

  it("fills red when over, plain on request, and is taller when asked", () => {
    expect(renderToStaticMarkup(<ProgressBar label="x" percent={100} fill="over" />)).toContain(
      "bg-red-600",
    );
    expect(renderToStaticMarkup(<ProgressBar label="x" percent={5} fill="plain" />)).toContain(
      "bg-zinc-900 dark:bg-zinc-100",
    );
    expect(renderToStaticMarkup(<ProgressBar label="x" percent={5} tall />)).toContain(
      'class="h-3 w-full overflow-hidden',
    );
  });
});
