import {
  DEFAULT_PANEL,
  EMBED_PATH,
  panelKey,
  parsePanelState,
  type PanelState,
  type SheetState,
} from "@/lib/side-chat";

// The side chat's state in the browser, shared by the panel (in the root layout, so it stays
// put when the person changes tab), the app header that says who is signed in, and the top
// bar's Chat button. A tiny store for useSyncExternalStore.

export type SideChatSnapshot = {
  // Who is signed in, from the last app header on screen. It stays while the next page loads
  // (its header comes with its content), so changing tab never takes the panel away; the
  // panel itself shows only on signed-in pages (src/lib/side-chat.ts, panelShowsOn).
  userId: string | null;
  panel: PanelState;
  sheet: SheetState;
  unread: number;
  // What the framed chat shows: its newest messages, or what a /chat link asked for.
  src: string;
};

const SERVER: SideChatSnapshot = {
  userId: null,
  panel: DEFAULT_PANEL,
  sheet: "closed",
  unread: 0,
  src: EMBED_PATH,
};
// A /chat link opened the chat before the page said who is signed in: open it then too.
let openOnRegister = false;
let snapshot: SideChatSnapshot = SERVER;
const listeners = new Set<() => void>();

function set(next: Partial<SideChatSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

// Browser storage can be missing or throw (private windows, blocked site data).
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience; the panel works without it.
  }
}

export const sideChatStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => snapshot,
  server: () => SERVER,

  // An app header is on screen: this person is signed in.
  register(userId: string) {
    if (snapshot.userId === userId) return;
    const panel = parsePanelState(read(panelKey(userId)));
    set({
      userId,
      panel: openOnRegister && panel === "rail" ? "open" : panel,
      sheet: openOnRegister ? "half" : "closed",
      unread: 0,
    });
    openOnRegister = false;
  },

  // A /chat link (src/lib/side-chat.ts, openedChat): the chat comes into view showing `src`,
  // docked beside the page on a computer, the half sheet on a phone.
  openChat(src: string) {
    set({ src, sheet: "half", panel: snapshot.panel === "rail" ? "open" : snapshot.panel });
    if (!snapshot.userId) openOnRegister = true;
  },

  setPanel(panel: PanelState) {
    set({ panel });
    if (snapshot.userId) write(panelKey(snapshot.userId), panel);
    document.documentElement.dataset.sideChat = panel;
  },
  setSheet(sheet: SheetState) {
    set({ sheet });
  },
  setUnread(unread: number) {
    if (unread !== snapshot.unread) set({ unread });
  },
};
