import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isHiddenPage } from "@/config/hidden-pages";
import {
  PAGE_OLD_MS,
  PRELOAD_MAX_PER_HOUR,
  PRELOAD_MIN_GAP_MS,
  PRELOAD_PAGES,
  SIGNED_OUT_PAGES,
} from "@/config/page-cache";
import { isInMemory } from "./page-memory";
import {
  actionEmptiedCache,
  ageOf,
  changesData,
  connectionAllowsPreload,
  leaving,
  nextRoundAt,
  pageChanged,
  pageShown,
  pagesToPreload,
  resetPageCacheForTests,
  startPageCache,
  type PageCacheRouter,
} from "./page-cache";

const HERE = "https://jane.test/home";

describe("which requests empty the memory", () => {
  it("is every post from this site", () => {
    expect(changesData("/api/chat/send", "POST", HERE)).toBe(true);
    expect(changesData("/plan", "POST", HERE)).toBe(true);
    expect(changesData("/api/push", "delete", HERE)).toBe(true);
    // A route nobody has thought about yet is safe by default.
    expect(changesData("/api/something-new", "POST", HERE)).toBe(true);
  });

  it("isn't a read, another site, or a report that changes nothing a page shows", () => {
    expect(changesData("/api/chat/unread", "GET", HERE)).toBe(false);
    expect(changesData("https://other.test/api", "POST", HERE)).toBe(false);
    for (const post of ["/api/events", "/api/activity", "/api/opened", "/api/client-error"]) {
      expect(changesData(post, "POST", HERE)).toBe(false);
    }
  });

  it("knows an action's reply emptied everything only when it says so", () => {
    expect(actionEmptiedCache("1")).toBe(true);
    // refresh() keeps what was preloaded, and no header keeps it all.
    expect(actionEmptiedCache("2")).toBe(false);
    expect(actionEmptiedCache(null)).toBe(false);
  });
});

describe("a round of background loading", () => {
  it("has every main page, none of them hidden in the beta, and never the page you're on", () => {
    for (const page of [
      "/home",
      "/money",
      "/insurance",
      "/loans",
      "/taxes",
      "/investments",
      "/plan",
      "/report",
    ]) {
      expect(PRELOAD_PAGES).toContain(page);
    }
    expect(PRELOAD_PAGES.filter((page) => isHiddenPage(page))).toEqual([]);
    expect(pagesToPreload("/money")).not.toContain("/money");
    expect(pagesToPreload("/money")).toContain("/home");
  });

  it("is skipped with Save-Data on or on a slow connection", () => {
    expect(connectionAllowsPreload(undefined)).toBe(true);
    expect(connectionAllowsPreload({ effectiveType: "4g" })).toBe(true);
    expect(connectionAllowsPreload({ saveData: true, effectiveType: "4g" })).toBe(false);
    for (const effectiveType of ["slow-2g", "2g", "3g"]) {
      expect(connectionAllowsPreload({ effectiveType })).toBe(false);
    }
  });

  it("is kept apart from the last one and limited per hour", () => {
    expect(nextRoundAt([], 1_000)).toBe(1_000);
    expect(nextRoundAt([1_000], 2_000)).toBe(1_000 + PRELOAD_MIN_GAP_MS);
    const start = 1_000_000;
    const full = Array.from(
      { length: PRELOAD_MAX_PER_HOUR },
      (_, i) => start + i * PRELOAD_MIN_GAP_MS,
    );
    const wanted = full.at(-1)! + PRELOAD_MIN_GAP_MS;
    expect(nextRoundAt(full, wanted)).toBe(start + 60 * 60_000);
  });
});

describe("a page's age", () => {
  afterEach(() => resetPageCacheForTests());

  it("is by the first page's clock gap, so a browser's wrong clock doesn't make all pages old", () => {
    const hoursAhead = 3 * 60 * 60_000;
    const madeAt = 1_000_000;
    expect(ageOf(madeAt, madeAt + hoursAhead)).toBe(0);
    expect(ageOf(madeAt, madeAt + hoursAhead + 60_000)).toBe(60_000);
  });
});

// The browser as far as the cache touches it: a page, its channel to other tabs, and the router.
type Listener = (event: never) => void;
function fakeBrowser({ framed = false, hidden = false, connection = undefined as unknown } = {}) {
  const channels: FakeChannel[] = [];
  class FakeChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    sent: unknown[] = [];
    constructor() {
      channels.push(this);
    }
    postMessage(message: unknown) {
      this.sent.push(message);
    }
  }
  const listeners: Record<string, Listener[]> = {};
  const on = (type: string, fn: Listener) => (listeners[type] ??= []).push(fn);
  const reload = vi.fn();
  const fetchImpl = vi.fn(
    async (_url: unknown, _init?: unknown) => new Response("ok", { status: 200 }),
  );
  const win = {
    self: 1 as unknown,
    top: framed ? 2 : (1 as unknown),
    location: { pathname: "/home", search: "", href: HERE, reload },
    fetch: fetchImpl,
    addEventListener: on,
    BroadcastChannel: FakeChannel,
    requestIdleCallback: (fn: () => void) => setTimeout(fn, 0),
  };
  const doc = {
    hidden,
    addEventListener: on,
    querySelector: vi.fn(() => null as unknown),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  vi.stubGlobal("navigator", { connection });
  const router: PageCacheRouter = { refresh: vi.fn(), prefetch: vi.fn() };
  const fire = (type: string, event: unknown) => {
    for (const fn of listeners[type] ?? []) fn(event as never);
  };
  const receive = (data: unknown) => channels[0]!.onmessage?.({ data });
  return { win, doc, router, reload, fetchImpl, channels, fire, receive };
}

const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
};

describe("in the browser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    resetPageCacheForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetPageCacheForTests();
  });

  describe("one person's pages never show to another", () => {
    it("loads the whole page again when a page for someone else arrives", () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      expect(b.reload).not.toHaveBeenCalled();
      pageShown("person_b", Date.now());
      expect(b.reload).toHaveBeenCalledOnce();
    });

    it("tells other tabs who's here, and goes when another tab has someone else", () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      expect(b.channels[0]!.sent).toContainEqual({ type: "owner", owner: "person_a" });
      b.receive({ type: "owner", owner: "person_a" });
      expect(b.reload).not.toHaveBeenCalled();
      b.receive({ type: "owner", owner: "person_b" });
      expect(b.reload).toHaveBeenCalledOnce();
    });

    it("goes when another tab signs out, and tells the others when this one does", () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      b.receive({ type: "gone" });
      expect(b.reload).toHaveBeenCalledOnce();

      resetPageCacheForTests();
      const c = fakeBrowser();
      startPageCache(c.router);
      pageShown("person_a", Date.now());
      leaving();
      expect(c.channels[0]!.sent).toContainEqual({ type: "gone" });
      expect(c.reload).toHaveBeenCalledOnce();
    });

    it("goes on arriving at a signed-out page from another page, not on opening one", () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      // A page load straight onto the landing page: nothing is held.
      pageChanged("/");
      expect(b.reload).not.toHaveBeenCalled();
      pageChanged("/home");
      for (const out of SIGNED_OUT_PAGES) {
        b.reload.mockClear();
        pageChanged("/home");
        pageChanged(out);
        expect(b.reload).toHaveBeenCalledOnce();
      }
      // Between signed-out pages: nothing to empty.
      b.reload.mockClear();
      pageChanged("/login");
      pageChanged("/signup");
      expect(b.reload).not.toHaveBeenCalled();
    });

    it("loads again when the browser restores the page from its own memory", () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      b.fire("pageshow", { persisted: false });
      expect(b.reload).not.toHaveBeenCalled();
      b.fire("pageshow", { persisted: true });
      expect(b.reload).toHaveBeenCalledOnce();
    });

    it("forgets what's in memory when the window empties", async () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      expect(isInMemory("/home")).toBe(true);
      b.win.location.pathname = "/money";
      b.receive({ type: "changed" });
      await vi.advanceTimersByTimeAsync(300);
      expect(isInMemory("/home")).toBe(false);
      expect(isInMemory("/money")).toBe(true);
    });
  });

  describe("after data changes", () => {
    const signedIn = () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      return b;
    };

    it("a post empties the memory and refreshes, once for a burst, and tells other tabs", async () => {
      const b = signedIn();
      await window.fetch("/plan", { method: "POST", headers: { "next-action": "abc" } });
      await window.fetch("/api/chat/act", { method: "POST" });
      await flush();
      await vi.advanceTimersByTimeAsync(300);
      expect(b.router.refresh).toHaveBeenCalledOnce();
      expect(b.channels[0]!.sent).toContainEqual({ type: "changed" });
    });

    it("doesn't refresh again after an action whose reply already did", async () => {
      const b = signedIn();
      b.fetchImpl.mockResolvedValueOnce(
        new Response("ok", { status: 200, headers: { "x-action-revalidated": "1" } }),
      );
      await window.fetch("/plan", { method: "POST" });
      await flush();
      await vi.advanceTimersByTimeAsync(300);
      expect(b.router.refresh).not.toHaveBeenCalled();
    });

    it("leaves things alone after a failed post, a read or a report", async () => {
      const b = signedIn();
      b.fetchImpl.mockResolvedValueOnce(new Response("no", { status: 500 }));
      await window.fetch("/plan", { method: "POST" });
      await window.fetch("/api/chat/unread");
      await window.fetch("/api/events", { method: "POST" });
      await flush();
      await vi.advanceTimersByTimeAsync(300);
      expect(b.router.refresh).not.toHaveBeenCalled();
      expect(b.channels[0]!.sent).not.toContainEqual({ type: "changed" });
    });

    it("the chat's frame only tells: the window around it refreshes", async () => {
      const b = fakeBrowser({ framed: true });
      startPageCache(b.router);
      await window.fetch("/api/chat/send", { method: "POST" });
      await flush();
      await vi.advanceTimersByTimeAsync(300);
      expect(b.channels[0]!.sent).toContainEqual({ type: "changed" });
      expect(b.router.refresh).not.toHaveBeenCalled();
    });

    it("a tab out of sight refreshes when it's back", async () => {
      const b = signedIn();
      (b.doc as { hidden: boolean }).hidden = true;
      b.receive({ type: "changed" });
      await vi.advanceTimersByTimeAsync(300);
      expect(b.router.refresh).not.toHaveBeenCalled();
      (b.doc as { hidden: boolean }).hidden = false;
      b.fire("visibilitychange", {});
      expect(b.router.refresh).toHaveBeenCalledOnce();
    });
  });

  describe("opening a page", () => {
    it("tells the server what it sets off, each time the page comes up", async () => {
      const b = fakeBrowser();
      vi.stubGlobal("fetch", b.fetchImpl);
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      expect(b.fetchImpl).not.toHaveBeenCalled();
      pageShown("person_a", Date.now(), { page: "plan", findingIds: ["abc"] });
      expect(b.fetchImpl).toHaveBeenCalledWith(
        "/api/opened",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ page: "plan", findingIds: ["abc"] }),
        }),
      );
    });
  });

  describe("an old page", () => {
    it("refreshes quietly when it comes up older than the limit, and not before", () => {
      const b = fakeBrowser();
      startPageCache(b.router);
      const start = Date.now();
      pageShown("person_a", start);
      vi.setSystemTime(start + PAGE_OLD_MS);
      pageShown("person_a", start);
      expect(b.router.refresh).not.toHaveBeenCalled();
      vi.setSystemTime(start + PAGE_OLD_MS + 1);
      pageShown("person_a", start);
      expect(b.router.refresh).toHaveBeenCalledOnce();
    });
  });

  describe("the rounds", () => {
    it("wait for the page to settle, then ask for each page once, in full", async () => {
      const b = fakeBrowser();
      b.doc.querySelector.mockReturnValue({});
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      await vi.advanceTimersByTimeAsync(5_000);
      expect(b.router.prefetch).not.toHaveBeenCalled();
      b.doc.querySelector.mockReturnValue(null);
      await vi.advanceTimersByTimeAsync(20_000);
      const asked = vi.mocked(b.router.prefetch).mock.calls.map(([page]) => page);
      expect(asked).toEqual(PRELOAD_PAGES.filter((page) => page !== "/home"));
      expect(vi.mocked(b.router.prefetch).mock.calls[0]![1]).toMatchObject({ kind: "full" });
      expect(isInMemory("/taxes")).toBe(true);
    });

    it("never run with Save-Data on, in the chat's frame or for nobody signed in", async () => {
      const saving = fakeBrowser({ connection: { saveData: true } });
      startPageCache(saving.router);
      pageShown("person_a", Date.now());
      await vi.advanceTimersByTimeAsync(30_000);
      expect(saving.router.prefetch).not.toHaveBeenCalled();

      resetPageCacheForTests();
      const framed = fakeBrowser({ framed: true });
      startPageCache(framed.router);
      pageShown("person_a", Date.now());
      await vi.advanceTimersByTimeAsync(30_000);
      expect(framed.router.prefetch).not.toHaveBeenCalled();

      resetPageCacheForTests();
      const nobody = fakeBrowser();
      startPageCache(nobody.router);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(nobody.router.prefetch).not.toHaveBeenCalled();
    });

    it("wait for a tab out of sight to come back", async () => {
      const b = fakeBrowser({ hidden: true });
      startPageCache(b.router);
      pageShown("person_a", Date.now());
      await vi.advanceTimersByTimeAsync(30_000);
      expect(b.router.prefetch).not.toHaveBeenCalled();
      (b.doc as { hidden: boolean }).hidden = false;
      b.fire("visibilitychange", {});
      await vi.advanceTimersByTimeAsync(30_000);
      expect(b.router.prefetch).toHaveBeenCalled();
    });
  });
});

// A page's render also runs when it loads ahead of time, and nobody has seen it then. What counts
// as someone opening it goes through src/lib/page-opened.ts or a client component.
describe("the pages loaded ahead of time", () => {
  const APP = join(__dirname, "..", "app");
  const code = (page: string) => readFileSync(join(APP, page.slice(1), "page.tsx"), "utf8");

  it.each(PRELOAD_PAGES)("%s does no work a real view would count as one", (page) => {
    const source = code(page);
    expect(source).not.toMatch(/\bafter\(/);
    expect(source).not.toMatch(/\btrack\(/);
    expect(source).not.toMatch(/\blogAudit\(/);
    expect(source).not.toMatch(/markPlanShown\(|scanOnOpenQuietly\(/);
  });
});

// A page people must always see as it is now is never kept (the router's unstable_dynamicStaleTime).
describe("the pages never kept in memory", () => {
  const APP = join(__dirname, "..", "app");
  const pagesUnder = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return pagesUnder(path);
      return name === "page.tsx" ? [path] : [];
    });
  const KEPT_OUT = ["chat", "jane", "scanning", "connect", "import", "mfa", "terms/accept"];

  it.each([
    ...KEPT_OUT.map((page) => join(APP, page, "page.tsx")),
    ...pagesUnder(join(APP, "admin")),
  ])("%s", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/^export const unstable_dynamicStaleTime = 0;$/m);
  });
});
