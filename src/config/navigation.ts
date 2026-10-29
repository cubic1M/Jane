// The main menu (spec steps 79, 81, 86; the home hub, docs/design/home-hub.md): the area tabs
// along the top (Home, Spending & bills, Insurance, Loans & credit, Taxes, Investing, Plans &
// goals), each landing on a hub that links its own sub-pages. The chat is the side panel, not a
// tab; What Jane did and Settings are in the profile menu. A page's sub-pages (/report/abc,
// /settings/two-factor) belong with it.

export type TabKey =
  | "chat"
  | "today"
  | "money"
  | "investments"
  | "loans"
  | "insurance"
  | "taxes"
  | "ahead"
  | "jane"
  | "settings";

export type Tab = {
  key: TabKey;
  label: string;
  href: string;
  // The pages it covers, its own first. Its sub-pages are listed on the page itself (a hub
  // page links each of them), not in the menu.
  paths: readonly string[];
  // Kept for lanes that still pass it; the top bar doesn't group tabs.
  group?: string;
};

// THE MENU, in order. Every signed-in page belongs to exactly one tab (the tests read
// src/app and fail on a page that doesn't), so a lane adding a page adds its path to its
// area's tab here and nowhere else. Settings isn't a tab: it's in the profile menu with What
// Jane did, and lights that up. Documents, things you own and the household are under it,
// linked from Spending & bills and Settings.
export const TABS: readonly Tab[] = [
  { key: "chat", label: "Chat", href: "/chat", paths: ["/chat"] },
  { key: "today", label: "Home", href: "/home", paths: ["/home"] },
  {
    key: "money",
    label: "Spending & bills",
    href: "/money",
    paths: [
      "/money",
      "/budgets",
      "/subscriptions",
      "/bills",
      "/transactions",
      "/transfers",
      "/insights",
      // Spec step 239: how a figure was worked out, opened from the figure itself.
      "/figures",
    ],
  },
  { key: "insurance", label: "Insurance", href: "/insurance", paths: ["/insurance"] },
  {
    key: "loans",
    label: "Loans & credit",
    href: "/loans",
    // The payoff planner (/debt) is the debt half of this tab.
    paths: ["/loans", "/debt"],
  },
  {
    key: "taxes",
    label: "Taxes",
    href: "/taxes",
    // The tax-time pack is the taxes tab's own page.
    paths: ["/taxes", "/tax-pack"],
  },
  {
    key: "investments",
    label: "Investing (practice)",
    href: "/investments",
    paths: ["/investments"],
  },
  {
    key: "ahead",
    label: "Plans & goals",
    href: "/ahead",
    // Goals and net worth are planning: the Plans & goals tree has them (area plan, 2026-10-23).
    paths: [
      "/ahead",
      "/goals",
      "/net-worth",
      "/afford",
      "/deadlines",
      "/life-events",
      "/check-in",
      "/monthly",
      "/what-if",
      "/long-view",
      "/year",
    ],
  },
  {
    key: "jane",
    label: "What Jane did",
    href: "/jane",
    paths: ["/jane", "/plan", "/report", "/actions", "/saved", "/close", "/profile"],
  },
];

export const SETTINGS_TAB: Tab = {
  key: "settings",
  label: "Settings",
  href: "/settings",
  // "Report a problem" is in the profile menu with Settings (src/components/profile-menu.tsx).
  paths: [
    "/settings",
    "/connect",
    "/import",
    "/documents",
    "/things",
    "/household",
    "/report-a-problem",
  ],
};

const ALL_TABS: readonly Tab[] = [...TABS, SETTINGS_TAB];

const covers = (path: string, pathname: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

// The tab a page belongs to, or null for pages outside the menu (sign-in, admin).
export function tabFor(pathname: string): TabKey | null {
  return ALL_TABS.find((tab) => tab.paths.some((path) => covers(path, pathname)))?.key ?? null;
}

// Every tab that claims a page; exactly one for every signed-in page (see the tests).
export function tabsClaiming(pathname: string): TabKey[] {
  return ALL_TABS.filter((tab) => tab.paths.some((path) => covers(path, pathname))).map(
    (tab) => tab.key,
  );
}

// The area tabs along the top, in order: every place but the chat (the side panel) and What
// Jane did (in the profile menu, with Settings).
export const AREA_TABS: readonly Tab[] = TABS.filter(
  (tab) => tab.key !== "chat" && tab.key !== "jane",
);

// The profile menu's places, besides Sign out.
export const PROFILE_TABS: readonly Tab[] = [TABS.find((tab) => tab.key === "jane")!, SETTINGS_TAB];
