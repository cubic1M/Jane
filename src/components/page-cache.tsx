"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Opened, PageCacheRouter } from "@/lib/page-cache";

// Moving between pages (src/lib/page-cache.ts). Loaded after the page: nothing in it is needed to
// draw one, and Home's JavaScript budget has no room for it. A page can't be kept or preloaded
// before it arrives, since the router's memory and the rounds are started from it too.
const pageCache = () => import("@/lib/page-cache");

export function PageCacheRoot() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    void pageCache().then((cache) => {
      cache.startPageCache(router as unknown as PageCacheRouter);
      cache.pageChanged(pathname);
    });
  }, [router, pathname]);
  return null;
}

// In the app header: a signed-in page is on screen, whose it is, when it was made and what opening
// it sets off. Once for each time the page comes up (refreshing it quietly doesn't start this again).
export function PageCacheMark(props: { userId: string; renderedAt: number; opened?: Opened }) {
  useEffect(() => {
    void pageCache().then((cache) => cache.pageShown(props.userId, props.renderedAt, props.opened));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
