import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./clear", () => ({ clearChatAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CLEAR_CHAT_WARNING, ClearChat } from "./clear-chat";

describe("ClearChat", () => {
  it("shows one plain button first, with the warning only after the tap", () => {
    const html = renderToStaticMarkup(<ClearChat />);
    expect(html).toContain("Clear chat");
    expect(html).not.toContain("deletes every message");
  });

  it("says exactly what happens", () => {
    expect(CLEAR_CHAT_WARNING).toBe(
      "This deletes every message in this chat for good, including pinned answers. What Jane knows about you stays.",
    );
  });
});
