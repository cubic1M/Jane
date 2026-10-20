import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { DETAIL_TABS, SETTINGS_TAB, TABS, isDetail, tabFor, tabsClaiming } from "./navigation";

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
  // Spec step 222: a read-only link for an accountant.
  "/accountant/[token]",
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
    for (const path of ["/money", "/net-worth", "/bills", "/subscriptions", "/transfers"]) {
      expect(tabFor(path), path).toBe("money");
    }
    expect(tabFor("/investments/fees")).toBe("investments");
    // Debt is the loans tab's other half, and the tax-time pack is a taxes page.
    for (const path of ["/loans", "/loans/mortgage", "/debt"]) {
      expect(tabFor(path), path).toBe("loans");
    }
    expect(tabFor("/insurance/claims")).toBe("insurance");
    for (const path of ["/taxes", "/taxes/file", "/tax-pack"]) {
      expect(tabFor(path), path).toBe("taxes");
    }
    for (const path of ["/ahead", "/afford", "/deadlines", "/life-events", "/check-in", "/year"]) {
      expect(tabFor(path), path).toBe("ahead");
    }
    // Spec step 81: Ask is opened from the chat, and lights up Chat.
    expect(tabFor("/chat")).toBe("chat");
    expect(tabFor("/ask")).toBe("chat");
    // Documents, things you own and the household are under Settings.
    for (const path of [
      "/settings",
      "/settings/team-access",
      "/connect",
      "/import",
      "/documents",
      "/things",
      "/household",
      "/household/join",
    ]) {
      expect(tabFor(path), path).toBe("settings");
    }
  });

  it("matches whole path segments, not prefixes", () => {
    expect(tabFor("/homework")).toBeNull();
    expect(tabFor("/plans")).toBeNull();
  });

  it("shows two places in the bar, Chat first, each linking to its own first page", () => {
    expect(TABS[0].label).toBe("Chat");
    for (const tab of [...TABS, SETTINGS_TAB]) expect(tab.paths[0]).toBe(tab.href);
  });

  // The Details menu is short: one entry per place, the sectors under one heading.
  it("lists one entry per place in Details, in the agreed order", () => {
    expect(DETAIL_TABS.map((t) => t.label)).toEqual([
      "Today",
      "Money",
      "Investments",
      "Loans and debt",
      "Insurance",
      "Taxes",
      "Ahead",
      "What Jane did",
    ]);
    expect(DETAIL_TABS.length).toBeLessThanOrEqual(12);
    expect(DETAIL_TABS.filter((t) => t.group).map((t) => t.group)).toEqual(
      Array(4).fill("Grow and protect"),
    );
  });

  it("reaches every signed-in page from the chat, Details, Settings or a place's hub", () => {
    const menuPaths = [...TABS, SETTINGS_TAB].flatMap((t) => t.paths);
    for (const route of all.filter((r) => !outside(r))) {
      expect(
        menuPaths.some((path) => route === path || route.startsWith(`${path}/`)),
        route,
      ).toBe(true);
    }
  });

  it("knows which pages are details", () => {
    for (const path of ["/home", "/plan", "/report/abc", "/bills", "/afford", "/debt", "/taxes"]) {
      expect(isDetail(path), path).toBe(true);
    }
    for (const path of ["/chat", "/ask", "/settings", "/login"]) {
      expect(isDetail(path), path).toBe(false);
    }
  });
});
