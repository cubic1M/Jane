import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DETAIL_PAGES,
  DETAIL_TABS,
  SETTINGS_TAB,
  TABS,
  isDetail,
  tabFor,
  tabsClaiming,
} from "./navigation";

// Spec step 79: every signed-in page belongs to exactly one tab. The page list is read
// from src/app, so a new page without a tab fails here.

const APP = join(process.cwd(), "src", "app");

// Every page.tsx under src/app, as its URL ("/report/[findingId]").
function pages(dir = APP): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    if (entry.name !== "page.tsx") return [];
    const route = relative(APP, dir)
      .split(sep)
      .filter((segment) => segment && !segment.startsWith("("))
      .join("/");
    return [`/${route}`];
  });
}

const fileOf = (route: string) => join(APP, ...route.split("/"), "page.tsx");

// Pages outside the menu: signed out, mid sign-in, after deleting, and the team's own.
const OUTSIDE = [
  "/",
  "/login",
  "/login/check-email",
  "/signup",
  "/privacy",
  "/terms",
  "/terms/accept",
  "/security",
  "/offline",
  "/goodbye",
  "/unsubscribe",
  "/mfa",
  "/scanning",
  // Spec step 139: a shared savings total.
  "/s/[token]",
];
const outside = (route: string) => OUTSIDE.includes(route) || route.startsWith("/admin");

describe("navigation", () => {
  const all = pages();

  it("finds the app's pages", () => {
    expect(all).toContain("/home");
    expect(all).toContain("/report/[findingId]");
    expect(all.length).toBeGreaterThan(30);
  });

  it("puts every signed-in page in exactly one tab", () => {
    for (const route of all.filter((r) => !outside(r))) {
      expect(tabsClaiming(route), route).toHaveLength(1);
    }
  });

  it("puts every page with the app header in a tab", () => {
    for (const route of all) {
      if (readFileSync(fileOf(route), "utf8").includes("<AppHeader")) {
        expect(outside(route), route).toBe(false);
        expect(tabFor(route), route).not.toBeNull();
      }
    }
  });

  it("leaves sign-in and admin pages out", () => {
    for (const route of all.filter(outside)) expect(tabFor(route), route).toBeNull();
  });

  it("maps the pages people know to the agreed tabs", () => {
    expect(tabFor("/home")).toBe("today");
    for (const path of ["/jane", "/plan", "/report", "/report/abc", "/actions", "/alerts"]) {
      expect(tabFor(path), path).toBe("jane");
    }
    for (const path of ["/money", "/net-worth", "/bills", "/household", "/household/join"]) {
      expect(tabFor(path), path).toBe("money");
    }
    for (const path of [
      "/ahead",
      "/afford",
      "/deadlines",
      "/debt",
      "/year",
      "/tax-pack",
      "/taxes",
    ]) {
      expect(tabFor(path), path).toBe("ahead");
    }
    // Spec step 81: Ask is opened from the chat, and lights up Chat.
    expect(tabFor("/chat")).toBe("chat");
    expect(tabFor("/ask")).toBe("chat");
    for (const path of ["/settings", "/settings/team-access", "/connect", "/import"]) {
      expect(tabFor(path), path).toBe("settings");
    }
  });

  it("matches whole path segments, not prefixes", () => {
    expect(tabFor("/homework")).toBeNull();
    expect(tabFor("/plans")).toBeNull();
  });

  it("shows five places in order, Chat first, each linking to its own first page", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Chat", "Today", "Jane", "Money", "Ahead"]);
    for (const tab of [...TABS, SETTINGS_TAB]) expect(tab.paths[0]).toBe(tab.href);
  });

  // Spec step 86: the chat is where things happen; the tabs are its details.
  it("puts Today, Jane, Money and Ahead behind Details, with every page under them", () => {
    expect(DETAIL_TABS.map((t) => t.label)).toEqual(["Today", "Jane", "Money", "Ahead"]);
    const inMenu = new Set([
      ...DETAIL_TABS.map((t) => t.href),
      ...Object.values(DETAIL_PAGES).flatMap((pages) => pages.map((p) => p.href)),
    ]);
    for (const tab of DETAIL_TABS)
      for (const path of tab.paths) expect(inMenu, path).toContain(path);
    expect(DETAIL_PAGES.money).toContainEqual({ label: "Net worth", href: "/net-worth" });
    expect(DETAIL_PAGES.ahead).toContainEqual({ label: "Can I afford it?", href: "/afford" });
  });

  it("reaches every signed-in page from the chat, the Details menu or Settings", () => {
    const menuPaths = [
      ...TABS[0].paths,
      ...SETTINGS_TAB.paths,
      ...DETAIL_TABS.map((t) => t.href),
      ...Object.values(DETAIL_PAGES).flatMap((pages) => pages.map((p) => p.href)),
    ];
    for (const route of all.filter((r) => !outside(r))) {
      expect(
        menuPaths.some((path) => route === path || route.startsWith(`${path}/`)),
        route,
      ).toBe(true);
    }
  });

  it("knows which pages are details", () => {
    for (const path of ["/home", "/plan", "/report/abc", "/bills", "/afford"]) {
      expect(isDetail(path), path).toBe(true);
    }
    for (const path of ["/chat", "/ask", "/settings", "/login"]) {
      expect(isDetail(path), path).toBe(false);
    }
  });
});
