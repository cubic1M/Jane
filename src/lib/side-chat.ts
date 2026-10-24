import { tabFor } from "@/config/navigation";
import {
  SHEET_CLOSE_BELOW,
  SHEET_FLICK_PX_PER_MS,
  SHEET_FULL,
  SHEET_HALF,
} from "@/config/side-chat";

// The side chat's rules, apart from the screen so they can be tested (docs/design/home-hub.md).
// The panel is the chat page itself (/chat?embed=1) in a frame; these say when it shows, what
// state it remembers, where the sheet comes to rest and which links leave the frame.

// Docked beside the page, a slim rail, or over the whole window.
export type PanelState = "open" | "rail" | "full";
export const PANEL_STATES: readonly PanelState[] = ["open", "rail", "full"];
export const DEFAULT_PANEL: PanelState = "open";

// The bottom sheet on a phone.
export type SheetState = "closed" | "half" | "full";

export const EMBED_PATH = "/chat?embed=1";

// Remembered per person in the browser.
export const panelKey = (userId: string) => `jane.sideChat:${userId}`;

export function parsePanelState(raw: string | null | undefined): PanelState {
  return PANEL_STATES.includes(raw as PanelState) ? (raw as PanelState) : DEFAULT_PANEL;
}

// The panel shows beside every signed-in page but the chat's own (which is the chat expanded).
export function panelShowsOn(pathname: string): boolean {
  const tab = tabFor(pathname);
  return tab !== null && tab !== "chat";
}

// Where the sheet comes to rest when a drag lets go. `share` is how much of the screen's
// height it covers now; `velocity` is px per ms, positive downwards.
export function snapSheet(share: number, velocity: number): SheetState {
  if (velocity > SHEET_FLICK_PX_PER_MS) return share > SHEET_HALF + 0.1 ? "half" : "closed";
  if (velocity < -SHEET_FLICK_PX_PER_MS) return "full";
  if (share < SHEET_CLOSE_BELOW) return "closed";
  return Math.abs(share - SHEET_FULL) < Math.abs(share - SHEET_HALF) ? "full" : "half";
}

export function sheetShare(state: SheetState): number {
  return state === "full" ? SHEET_FULL : state === "half" ? SHEET_HALF : 0;
}

// A link tapped inside the framed chat: the path the main window should open, or null when it
// stays in the frame (the chat's own pages, other sites, downloads, new tabs).
export function leavesFrame(
  href: string,
  origin: string,
  { target, download }: { target?: string | null; download?: boolean } = {},
): string | null {
  if (download || (target && target !== "_self")) return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname === "/chat" || url.pathname.startsWith("/chat/")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

// Messages between the page and the framed chat. Both sides check the origin and the sender.
export type FrameMessage =
  | { type: "jane:navigate"; href: string }
  // Where the panel is, and whether the page beside it is Home (whose hub shows the suggestions).
  | { type: "jane:panel"; state: PanelState | "sheet"; home?: boolean }
  | { type: "jane:refresh" }
  // The framed chat is listening: the page tells it where it is.
  | { type: "jane:ready" }
  | { type: "jane:ask"; text: string }
  // "Ask Jane" from the giant tree: send this now (no Send to press), or find where it was
  // asked before; the chat says where the question landed, and when Jane starts and finishes.
  | { type: "jane:send"; text: string }
  | { type: "jane:find"; text: string }
  | { type: "jane:bubble"; x: number; y: number }
  | { type: "jane:answering" }
  | { type: "jane:answered" };

export function isFrameMessage(data: unknown): data is FrameMessage {
  if (!data || typeof data !== "object") return false;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "jane:navigate":
      return typeof m.href === "string" && m.href.startsWith("/") && !m.href.startsWith("//");
    case "jane:panel":
      return (
        (m.state === "sheet" || PANEL_STATES.includes(m.state as PanelState)) &&
        (m.home === undefined || typeof m.home === "boolean")
      );
    case "jane:refresh":
    case "jane:ready":
    case "jane:answering":
    case "jane:answered":
      return true;
    case "jane:ask":
    case "jane:send":
    case "jane:find":
      return typeof m.text === "string" && m.text.length > 0 && m.text.length <= 300;
    case "jane:bubble":
      return Number.isFinite(m.x) && Number.isFinite(m.y);
    default:
      return false;
  }
}

// A link to the chat itself, tapped inside the frame: the same page with embed=1 kept, so the
// framed chat never grows a second header. Null for anything else.
export function chatInFrame(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== "/chat") return null;
  if (url.searchParams.get("embed") === "1") return null;
  url.searchParams.set("embed", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
