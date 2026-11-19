import type { Page } from "@playwright/test";
import { isHiddenPage } from "../src/config/hidden-pages";
import { framesDrawn } from "./waits";

// The "no dead ends" crawl (gate A, mvp-ready.md in the lanes' notes): from Home, every page a
// signed-in person can reach by a link, with every tree item and fold on it opened, checked for
// the ways a page can leave someone stuck, and for links to pages the read-only beta hides. Only links are followed and only tree items and folds
// are pressed, so nothing is answered, saved or deleted on the way.

export type FindingKind =
  // An error page or an HTTP error.
  | "error"
  // Words saying a thing isn't there for them: unavailable, demo only, coming soon.
  | "unavailable"
  // A heading, list or tree branch with nothing under it.
  | "empty"
  // A link to the very item it sits on: it only reopens itself.
  | "self-link"
  // Nothing on the page to press or follow.
  | "no-way-on"
  // A link to a page the read-only beta hides (src/config/hidden-pages.ts: nothing links to it).
  | "hidden-link";

export type Finding = { kind: FindingKind; page: string; detail: string };

export type CrawlResult = { pages: string[]; findings: Finding[] };

// Addresses a crawl never opens: signing in and out, the team's pages, files, the chat's frame
// (its own spec covers it) and the legal pages (static, linked from every page).
const SKIP =
  /^\/($|api|admin|login|signup|mfa|goodbye|unsubscribe|s\/|gift\/|join\/|accountant\/|chat|terms|privacy|security|offline|report-a-problem|scanning)/;

// The words of a page that tells a real person a thing isn't for them.
export const UNAVAILABLE =
  /\b(not available|isn['’]t available|only available|unavailable|coming soon|demo advice mode|demo only|only (in|on|with) (the )?demo|isn['’]t set up yet|not set up yet|not supported yet)\b/i;

// One address per page: no hash, no "from" (where the person came from), no tree focus (the crawl
// opens every tree item itself), and the rest in a fixed order.
export function pageKey(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  url.hash = "";
  url.searchParams.delete("from");
  url.searchParams.delete("focus");
  url.searchParams.sort();
  return url.pathname + (url.search === "?" ? "" : url.search);
}

// The address itself, focus included: what a self-link is compared against.
export function itemKey(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  url.hash = "";
  url.searchParams.delete("from");
  url.searchParams.sort();
  return url.pathname + (url.search === "?" ? "" : url.search);
}

export const crawlable = (key: string) => !SKIP.test(key);

// What one look at the page (as it is now, with whatever is open) finds, in the page itself.
export async function look(page: Page) {
  return page.evaluate((unavailableSource) => {
    const unavailable = new RegExp(unavailableSource, "i");
    const main = document.querySelector("main") ?? document.body;
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    // The page's own content: not the header (its tabs and menu are on every page).
    const header = main.querySelector("header");
    const own = (el: Element) => !header || !header.contains(el);
    const text = (main as HTMLElement).innerText;
    const found: { kind: string; detail: string }[] = [];

    const said = text.split("\n").find((line) => unavailable.test(line));
    if (said) found.push({ kind: "unavailable", detail: said.trim().slice(0, 160) });

    if (/^\s*(Something went wrong|This page could not be found|404)\b/m.test(text)) {
      found.push({ kind: "error", detail: text.trim().split("\n")[0].slice(0, 120) });
    }

    for (const h of main.querySelectorAll("h2, h3")) {
      if (!own(h) || !visible(h)) continue;
      const box = h.closest("section, [role=region]") ?? h.parentElement;
      if (!box || box === main) continue;
      const rest = (box as HTMLElement).innerText.replace((h as HTMLElement).innerText, "").trim();
      const things = box.querySelectorAll(
        "a, button, input, select, textarea, svg, img, canvas, [role=img]",
      );
      if (rest === "" && things.length === 0) {
        found.push({ kind: "empty", detail: `heading "${(h as HTMLElement).innerText.trim()}"` });
      }
    }
    for (const list of main.querySelectorAll("ul, ol")) {
      // An empty list has no size: shown by its styles, not by its box.
      if (!own(list) || !(list as HTMLElement).checkVisibility({ visibilityProperty: true }))
        continue;
      if (
        list.querySelectorAll(":scope > li").length === 0 &&
        (list as HTMLElement).innerText.trim() === ""
      ) {
        const label =
          list.getAttribute("aria-label") ?? list.previousElementSibling?.textContent ?? "";
        found.push({ kind: "empty", detail: `list ${label.trim().slice(0, 80)}`.trim() });
      }
    }
    for (const nav of main.querySelectorAll("nav")) {
      if (own(nav) && nav.querySelectorAll("a[href]").length === 0) {
        found.push({ kind: "empty", detail: `links "${nav.getAttribute("aria-label") ?? ""}"` });
      }
    }
    for (const tree of main.querySelectorAll("[role=tree]")) {
      if (tree.querySelectorAll("[role=treeitem]").length === 0) {
        found.push({ kind: "empty", detail: `tree "${tree.getAttribute("aria-label") ?? ""}"` });
      }
    }
    for (const item of main.querySelectorAll("[role=treeitem][aria-expanded=true]")) {
      const group =
        item.querySelector("[role=group]") ??
        document.getElementById(item.getAttribute("aria-owns") ?? "");
      if (group && group.querySelectorAll("[role=treeitem]").length === 0) {
        found.push({
          kind: "empty",
          detail: `branch "${(item as HTMLElement).innerText.split("\n")[0]}"`,
        });
      }
    }

    const links = [...main.querySelectorAll("a[href]")]
      .filter((a) => own(a) && visible(a) && !a.hasAttribute("download"))
      .map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: ((a as HTMLElement).innerText || a.getAttribute("aria-label") || "")
          .trim()
          .slice(0, 60),
        current: a.getAttribute("aria-current") !== null,
      }));
    const pressable = [
      ...main.querySelectorAll("a[href], button, input, select, summary, [role=treeitem]"),
    ].filter((el) => own(el) && visible(el)).length;
    const tabs = [...document.querySelectorAll("#main-nav a[href]")].map(
      (a) => (a as HTMLAnchorElement).href,
    );
    const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 200);
    return { found, links, pressable, url: location.href, tabs, excerpt };
  }, UNAVAILABLE.source);
}

// Settled: hydrated, and no page-loading bar left.
export async function settle(page: Page) {
  await page
    .locator('html[data-taps="ready"]')
    .waitFor({ state: "attached", timeout: 60_000 })
    .catch(() => {});
  await page
    .waitForFunction(
      () => !document.querySelector('main [role=progressbar][aria-label^="Loading"]'),
      null,
      {
        timeout: 30_000,
      },
    )
    .catch(() => {});
  // Its own content is in: a page heading under the header (every page has one), and no loading bar.
  await page
    .waitForFunction(
      () =>
        !!document.querySelector("main h1") &&
        !document.querySelector("main [role=progressbar], main [aria-busy=true]"),
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  await framesDrawn(page);
}

export async function crawl(
  page: Page,
  {
    origin,
    start = ["/home"],
    maxPages = 80,
    maxDepth = 3,
    maxItems = 40,
    log = () => {},
  }: {
    origin: string;
    start?: string[];
    maxPages?: number;
    maxDepth?: number;
    maxItems?: number;
    log?: (line: string) => void;
  },
): Promise<CrawlResult> {
  const seen = new Set<string>();
  const queue: { key: string; depth: number; from: string }[] = [];
  const findings: Finding[] = [];
  const pages: string[] = [];
  const add = (kind: FindingKind, at: string, detail: string) => {
    if (!findings.some((f) => f.kind === kind && f.page === at && f.detail === detail)) {
      findings.push({ kind, page: at, detail });
    }
  };
  for (const s of start) {
    const key = pageKey(s, origin);
    if (key && !seen.has(key)) {
      seen.add(key);
      queue.push({ key, depth: 0, from: "(start)" });
    }
  }

  while (queue.length > 0 && pages.length < maxPages) {
    const { key, depth, from } = queue.shift()!;
    const response = await page
      .goto(origin + key, { waitUntil: "domcontentloaded", timeout: 90_000 })
      .catch(() => null);
    await settle(page);
    const landed = pageKey(page.url(), origin) ?? key;
    // A redirect to a page already seen (an empty area sending them to /connect, say) is that page.
    if (landed !== key && seen.has(landed) && pages.includes(landed)) continue;
    pages.push(landed);
    log(`${pages.length} ${landed} (from ${from})`);
    if (!response || response.status() >= 400) {
      add("error", landed, `HTTP ${response?.status() ?? "no answer"} (linked from ${from})`);
      continue;
    }

    const links = new Map<string, string>();
    const take = async () => {
      const seenNow = await look(page);
      const here = itemKey(seenNow.url, origin);
      const at = pageKey(seenNow.url, origin) ?? landed;
      for (const f of seenNow.found) add(f.kind as FindingKind, at, f.detail);
      for (const l of seenNow.links) {
        const target = itemKey(l.href, origin);
        if (!target) continue;
        // A link to the item it sits on (a tree item's own address, focus and all): it reopens it.
        // A jump within the page ("#start") is a way down it, not back to itself.
        const jump = new URL(l.href).hash !== "";
        if (target === here && !l.current && !jump) add("self-link", at, `"${l.text}" → ${target}`);
        const goes = new URL(l.href).pathname;
        if (isHiddenPage(goes)) add("hidden-link", at, `"${l.text}" → ${goes}`);
        const next = pageKey(l.href, origin);
        if (next && crawlable(next) && !links.has(next)) links.set(next, l.text);
      }
      return seenNow;
    };

    // Every fold open, then a look.
    await page.evaluate(() => {
      for (const d of document.querySelectorAll("main details"))
        (d as HTMLDetailsElement).open = true;
    });
    const first = await take();
    if (first.pressable === 0)
      add("no-way-on", landed, `nothing to press or follow: "${first.excerpt}"`);
    // The area tabs are a way to every area from anywhere: each is a start of its own.
    for (const tab of first.tabs) {
      const next = pageKey(tab, origin);
      if (next && crawlable(next) && !seen.has(next)) {
        seen.add(next);
        queue.push({ key: next, depth: 0, from: "(area tab)" });
      }
    }

    // Every tree item, one at a time: its detail is a page of its own to the person.
    const items = page.locator("main [role=treeitem]");
    for (let i = 0; i < maxItems; i += 1) {
      const count = await items.count();
      if (i >= count) break;
      const item = items.nth(i);
      if ((await item.getAttribute("aria-expanded")) === "true") continue;
      if (!(await item.isVisible().catch(() => false))) continue;
      await item.click({ timeout: 5_000 }).catch(() => {});
      // Its detail is drawn in the same frame as the press (the tree answers at once, tap.spec).
      await framesDrawn(page);
      const now = pageKey(page.url(), origin);
      // A tree item that opens another page: that page is crawled on its own; back to this one.
      if (now !== landed) {
        if (now && crawlable(now) && !links.has(now)) links.set(now, "(tree item)");
        await page.goto(origin + key, { waitUntil: "domcontentloaded" }).catch(() => {});
        await settle(page);
        continue;
      }
      await page.evaluate(() => {
        for (const d of document.querySelectorAll("main details"))
          (d as HTMLDetailsElement).open = true;
      });
      await take();
    }

    if (depth >= maxDepth) continue;
    for (const [next, text] of links) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ key: next, depth: depth + 1, from: `${landed} "${text}"` });
    }
  }
  return { pages, findings };
}
