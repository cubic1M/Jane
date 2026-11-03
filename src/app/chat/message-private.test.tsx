import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  googleEnabled: false,
}));
vi.mock("./actions", () => ({ tapButton: vi.fn() }));
vi.mock("@/lib/compare-actions", () => ({ pickCompared: vi.fn() }));
vi.mock("./practice-actions", () => ({ putAwayPracticeCard: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import type { MessageView } from "@/lib/jane-agent/view";
import { ChatMessageItem } from "./message";

const message = (fromJane: boolean) =>
  ({
    id: "m1",
    kind: "reply",
    fromJane,
    tag: "",
    time: "9:00",
    body: "the words",
    status: "open",
    answeredWith: null,
    note: null,
    advice: false,
    buttons: [],
    links: [],
    undoUntil: null,
    block: null,
    pinned: false,
    suggestion: false,
    refs: {},
  }) as unknown as MessageView;

describe("a chat message and the activity log", () => {
  // data-private is what the recorder reads: a click there keeps no words.
  it.each([
    ["what the person typed", false],
    ["what Jane answered", true],
  ])("marks %s private", (_, fromJane) => {
    const html = renderToStaticMarkup(<ChatMessageItem initial={message(fromJane)} />);
    expect(html).toMatch(/<p[^>]*data-private[^>]*>the words/);
  });
});
