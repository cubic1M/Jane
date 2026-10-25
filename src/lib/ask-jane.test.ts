import { beforeEach, describe, expect, it, vi } from "vitest";
import { askedBefore, rememberAsked } from "./ask-jane";

// "Ask Jane" from the giant tree: one send per question per session.

const store = new Map<string, string>();
vi.stubGlobal("window", {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
});

describe("questions asked from the tree", () => {
  beforeEach(() => store.clear());

  it("remembers a question for the session, once", () => {
    expect(askedBefore("How does Jane cut my bank fees?")).toBe(false);
    rememberAsked("How does Jane cut my bank fees?");
    rememberAsked("How does Jane cut my bank fees?");
    expect(askedBefore("How does Jane cut my bank fees?")).toBe(true);
    expect(JSON.parse(store.get("jane.askedFromTree")!)).toHaveLength(1);
  });

  it("forgets nothing it can't read, and never throws", () => {
    store.set("jane.askedFromTree", "not json");
    expect(askedBefore("x")).toBe(false);
    expect(() => rememberAsked("x")).not.toThrow();
  });
});
