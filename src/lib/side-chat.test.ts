import { describe, expect, it } from "vitest";
import {
  chatInFrame,
  isFrameMessage,
  leavesFrame,
  panelKey,
  panelShowsOn,
  parsePanelState,
  sheetShare,
  snapSheet,
  chatRedirect,
  openedChat,
} from "./side-chat";

// The side chat's rules (docs/design/home-hub.md).

const ORIGIN = "https://jane.example";

describe("the panel's state", () => {
  it("is remembered per person, docked open unless they folded or expanded it", () => {
    expect(panelKey("user_1")).toBe("jane.sideChat:user_1");
    expect(parsePanelState(null)).toBe("open");
    expect(parsePanelState("rail")).toBe("rail");
    expect(parsePanelState("full")).toBe("full");
    expect(parsePanelState("sideways")).toBe("open");
  });

  it("shows beside every signed-in page but the chat's own, and never on signed-out pages", () => {
    for (const path of ["/home", "/money", "/loans/cards", "/settings", "/report/abc"]) {
      expect(panelShowsOn(path), path).toBe(true);
    }
    for (const path of ["/chat", "/chat/search", "/ask", "/", "/login", "/admin/queue"]) {
      expect(panelShowsOn(path), path).toBe(false);
    }
  });
});

describe("the sheet on a phone", () => {
  it("rests at half, full or closed, whichever is nearest", () => {
    expect(snapSheet(0.45, 0)).toBe("half");
    expect(snapSheet(0.8, 0)).toBe("full");
    expect(snapSheet(0.1, 0)).toBe("closed");
  });

  it("follows a flick: up opens it full, down closes it (or drops from full to half)", () => {
    expect(snapSheet(0.5, -1)).toBe("full");
    expect(snapSheet(0.5, 1)).toBe("closed");
    expect(snapSheet(0.85, 1)).toBe("half");
  });

  it("knows each resting height", () => {
    expect(sheetShare("closed")).toBe(0);
    expect(sheetShare("half")).toBeLessThan(sheetShare("full"));
  });
});

describe("links inside the framed chat", () => {
  it("open other pages in the main window", () => {
    expect(leavesFrame("/report/abc?from=m1", ORIGIN)).toBe("/report/abc?from=m1");
    expect(leavesFrame(`${ORIGIN}/subscriptions#hulu`, ORIGIN)).toBe("/subscriptions#hulu");
  });

  it("keep the chat's own pages, other sites, new tabs and downloads where they are", () => {
    expect(leavesFrame("/chat#m1", ORIGIN)).toBeNull();
    expect(leavesFrame("/chat/search?q=hulu", ORIGIN)).toBeNull();
    expect(leavesFrame("https://other.example/x", ORIGIN)).toBeNull();
    expect(leavesFrame("/report/abc", ORIGIN, { target: "_blank" })).toBeNull();
    expect(leavesFrame("/api/export", ORIGIN, { download: true })).toBeNull();
  });

  it("keep the panel's view when they go to the chat itself", () => {
    expect(chatInFrame("/chat?pages=2", ORIGIN)).toBe("/chat?pages=2&embed=1");
    expect(chatInFrame("/chat#m1", ORIGIN)).toBe("/chat?embed=1#m1");
    expect(chatInFrame("/chat?embed=1", ORIGIN)).toBeNull();
    expect(chatInFrame("/home", ORIGIN)).toBeNull();
  });
});

describe("messages between the page and the frame", () => {
  it("accept only the known shapes, and only paths on this site", () => {
    expect(isFrameMessage({ type: "jane:navigate", href: "/home" })).toBe(true);
    expect(isFrameMessage({ type: "jane:navigate", href: "//evil.example" })).toBe(false);
    expect(isFrameMessage({ type: "jane:navigate", href: "https://evil.example" })).toBe(false);
    expect(isFrameMessage({ type: "jane:panel", state: "full" })).toBe(true);
    expect(isFrameMessage({ type: "jane:panel", state: "sheet" })).toBe(true);
    expect(isFrameMessage({ type: "jane:panel", state: "huge" })).toBe(false);
    expect(isFrameMessage({ type: "jane:panel", state: "open", home: true })).toBe(true);
    expect(isFrameMessage({ type: "jane:panel", state: "open", home: "yes" })).toBe(false);
    expect(isFrameMessage({ type: "jane:refresh" })).toBe(true);
    expect(isFrameMessage({ type: "jane:ready" })).toBe(true);
    expect(isFrameMessage({ type: "jane:ask", text: "What is idle cash?" })).toBe(true);
    expect(isFrameMessage({ type: "jane:ask", text: "" })).toBe(false);
    expect(isFrameMessage({ type: "other" })).toBe(false);
    expect(isFrameMessage(null)).toBe(false);
  });
});

describe("no chat page of its own", () => {
  it("sends /chat to Home with the side chat open, keeping what it was asked to show", () => {
    expect(chatRedirect({})).toBe("/home?chat=open");
    expect(chatRedirect({ pages: "2", from: "m1" })).toBe("/home?chat=open&pages=2&from=m1");
    // The panel's own address never redirects; this is never asked about it.
    expect(chatRedirect({ embed: "1", chat: "x" })).toBe("/home?chat=open");
  });

  it("opens the framed chat there, and tidies the address", () => {
    expect(openedChat("?chat=open&pages=2", "#m1")).toEqual({
      src: "/chat?embed=1&pages=2#m1",
      address: "",
    });
    expect(openedChat("?chat=open&focus=needs", "")).toEqual({
      src: "/chat?embed=1",
      address: "?focus=needs",
    });
    expect(openedChat("?focus=needs", "")).toBeNull();
  });
});
