// Which pages the router has in memory, as far as this window knows, for the tapped link's bar
// (src/components/nav-pending.tsx). Its own small file: every page loads it at once, and the rest
// of src/lib/page-cache.ts loads after.
const until = new Map<string, number>();

// The tapped link's bar waits this long, so a page that is nearly here doesn't flash it. A page
// that isn't in memory gets a short wait, to stay inside "every tap answers at once" (e2e/tap.spec.ts);
// one that is gets a long one, in case something emptied the memory since.
export const BAR_WAIT_MS = 80;
export const BAR_WAIT_READY_MS = 600;

export const isInMemory = (path: string) => (until.get(path) ?? 0) > Date.now();
export const keepInMemory = (path: string, ms: number) => until.set(path, Date.now() + ms);
export const forgetMemory = () => until.clear();
