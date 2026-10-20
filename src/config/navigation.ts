// The main menu (spec steps 79, 81, 86), reorganised: the chat first, then a Details menu
// with one entry per place: Today, Money, the four "Grow and protect" sectors (Investments,
// Loans and debt, Insurance, Taxes), Ahead and What Jane did. Each lands on a hub that links
// its own sub-pages. A page's sub-pages (/report/abc, /settings/two-factor) belong with it.
// Ask left the menu for the chat's message box, and still lights up Chat.

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
  // A heading the menu shows above a run of tabs with the same one.
  group?: string;
};

// THE MENU, in order. Every signed-in page belongs to exactly one tab (the tests read
// src/app and fail on a page that doesn't), so a lane adding a page adds its path to its
// sector's tab here and nowhere else; a new sector adds a tab. Settings isn't a tab: it's
// in the profile menu, and lights that up. Documents, things you own and the household are
// under it, linked from Money and Settings.
export const TABS: readonly Tab[] = [
  { key: "chat", label: "Chat", href: "/chat", paths: ["/chat", "/ask"] },
  { key: "today", label: "Today", href: "/home", paths: ["/home"] },
  {
    key: "money",
    label: "Money",
    href: "/money",
    paths: [
      "/money",
      "/net-worth",
      "/goals",
      "/budgets",
      "/subscriptions",
      "/bills",
      "/transactions",
      "/transfers",
      "/insights",
    ],
  },
  {
    key: "investments",
    label: "Investments",
    href: "/investments",
    paths: ["/investments"],
    group: "Grow and protect",
  },
  {
    key: "loans",
    label: "Loans and debt",
    href: "/loans",
    // The payoff planner (/debt) is the debt half of this tab.
    paths: ["/loans", "/debt"],
    group: "Grow and protect",
  },
  {
    key: "insurance",
    label: "Insurance",
    href: "/insurance",
    paths: ["/insurance"],
    group: "Grow and protect",
  },
  {
    key: "taxes",
    label: "Taxes",
    href: "/taxes",
    // The tax-time pack is the taxes tab's own page.
    paths: ["/taxes", "/tax-pack"],
    group: "Grow and protect",
  },
  {
    key: "ahead",
    label: "Ahead",
    href: "/ahead",
    paths: [
      "/ahead",
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
    paths: ["/jane", "/plan", "/report", "/actions", "/alerts", "/saved", "/learn", "/profile"],
  },
];

export const SETTINGS_TAB: Tab = {
  key: "settings",
  label: "Settings",
  href: "/settings",
  paths: ["/settings", "/connect", "/import", "/documents", "/things", "/household"],
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

// Spec step 86: the tabs behind the Details menu, in menu order.
export const DETAIL_TABS: readonly Tab[] = TABS.filter((tab) => tab.key !== "chat");

// Whether a page is one of the details (anything in the menu but Chat).
export const isDetail = (pathname: string) => DETAIL_TABS.some((t) => t.key === tabFor(pathname));
