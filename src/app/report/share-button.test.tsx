import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./share-actions", () => ({ prepareShare: vi.fn(), shareSent: vi.fn() }));

import { prepareShare } from "./share-actions";
import { ShareButton } from "./share-button";

describe("ShareButton", () => {
  it("starts as one Share button, making no link until it's tapped", () => {
    const html = renderToStaticMarkup(<ShareButton card={{ kind: "found", dollars: 1200 }} />);
    expect(html).toContain(">Share</button>");
    expect(html).not.toContain("<img");
    expect(prepareShare).not.toHaveBeenCalled();
  });
});
