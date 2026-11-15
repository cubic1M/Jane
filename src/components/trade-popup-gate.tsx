"use client";

import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { sideChatStore } from "@/components/side-chat/store";

// The paper account's trade pop-up (src/components/trade-popup.tsx) runs only in demo advice mode,
// the only place it can have a trade (speed round, 11-15). Before, every signed-in page loaded its
// code and asked /api/paper/signals on every page, on focus and every minute, for an answer that
// was always empty outside advice mode. Mounted once from the root layout, so changing tab never
// resets it; it loads when a page of the signed-in person says they're in advice mode.
const TradePopup = lazy(() => import("./trade-popup").then((m) => ({ default: m.TradePopup })));

const usePaper = () =>
  useSyncExternalStore(
    sideChatStore.subscribe,
    () => {
      const { userId, paperFor } = sideChatStore.get();
      return !!userId && userId === paperFor;
    },
    () => false,
  );

export function TradePopupGate() {
  // Which pages show it is the pop-up's own call; it stays mounted between them, so a trade just
  // taken still shows its Revert on the next page.
  if (!usePaper()) return null;
  return (
    <Suspense>
      <TradePopup />
    </Suspense>
  );
}

// Said by the app header for a person in demo advice mode (src/components/paper-mark.tsx).
export function PaperUser({ userId }: { userId: string }) {
  useEffect(() => sideChatStore.setPaperFor(userId), [userId]);
  return null;
}
