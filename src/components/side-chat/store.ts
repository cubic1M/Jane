import {
  DEFAULT_PANEL,
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
};

const SERVER: SideChatSnapshot = { userId: null, panel: DEFAULT_PANEL, sheet: "closed", unread: 0 };
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
    set({ userId, panel: parsePanelState(read(panelKey(userId))), sheet: "closed", unread: 0 });
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
