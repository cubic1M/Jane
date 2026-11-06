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

import { AI_WRITTEN_LABEL, DEMO_ADVICE_LABEL } from "@/config/advice";
import type { MessageView } from "@/lib/jane-agent/view";
import { ChatMessageItem } from "./message";

// An answer Claude wrote about investing or taxes says so under it (AI_WRITTEN_LABEL), next to
// the demo advice label when it is that too; other answers don't.
const message = (over: Partial<MessageView>) =>
  ({
    id: "m1",
    kind: "reply",
    fromJane: true,
    tag: "",
    time: "9:00",
    body: "Your 401(k) holds $1,973.33.",
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
    ...over,
  }) as unknown as MessageView;
const html = (over: Partial<MessageView>) =>
  renderToStaticMarkup(<ChatMessageItem initial={message(over)} />);

describe("the AI note under a chat answer", () => {
  it("shows under an AI-written answer about investing or taxes", () => {
    expect(html({ aiWritten: true })).toContain(AI_WRITTEN_LABEL);
  });

  it("sits beside the demo advice label", () => {
    const both = html({ aiWritten: true, advice: true });
    expect(both).toContain(AI_WRITTEN_LABEL);
    expect(both).toContain(DEMO_ADVICE_LABEL);
  });

  it("isn't on other answers", () => {
    expect(html({})).not.toContain(AI_WRITTEN_LABEL);
  });
});
