import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorScreen } from "./error-screen";

describe("ErrorScreen", () => {
  it("says what happened and the way on: Home, and a report about this page", () => {
    const html = renderToStaticMarkup(
      <ErrorScreen title="Page not found" words="There's nothing here." from="/net-worth?x=1" />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Page not found");
    expect(html).toContain('href="/home"');
    expect(html).toContain('href="/report-a-problem?from=%2Fnet-worth%3Fx%3D1"');
  });
});
