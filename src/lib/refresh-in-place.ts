"use server";

import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/session";

// The page on screen, made again (src/lib/page-cache.ts): an old page, or one made before a chat
// message, refreshes itself while the other pages stay in the browser's memory. router.refresh()
// would empty them all, so the next tab after it went to the server.
export async function refreshInPlace(): Promise<void> {
  if (await getCurrentUser()) refresh();
}
