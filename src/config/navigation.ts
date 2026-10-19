// The main menu (spec step 79): Jane's chat first (spec step 81), then four tabs, with
// Settings behind the profile menu. Every signed-in page belongs to exactly one of them, so
// the right tab lights up wherever the person is. A page's sub-pages (/report/abc,
// /settings/two-factor) belong with it. Ask left the menu for the chat's message box, and
// still lights up Chat.

export type TabKey = "chat" | "today" | "jane" | "money" | "ahead" | "settings";

export type Tab = {
  key: TabKey;
  label: string;
  href: string;
  // The pages it covers, its own first.
  paths: readonly string[];
};

// In menu order. Settings isn't a tab: it's in the profile menu, and lights that up.
export const TABS: readonly Tab[] = [
  { key: "chat", label: "Chat", href: "/chat", paths: ["/chat", "/ask"] },
  { key: "today", label: "Today", href: "/home", paths: ["/home"] },
  {
    key: "jane",
    label: "Jane",
    href: "/jane",
    paths: ["/jane", "/plan", "/report", "/actions", "/alerts"],
  },
  {
    key: "money",
    label: "Money",
    href: "/money",
    paths: [
      "/money",
      "/net-worth",
      "/loans",
      "/things",
      "/goals",
      "/budgets",
      "/subscriptions",
      "/bills",
      "/transactions",
      "/insights",
      "/documents",
      "/household",
    ],
  },
  {
    key: "ahead",
    label: "Ahead",
    href: "/ahead",
    paths: [
      "/ahead",
      "/afford",
      "/deadlines",
      "/debt",
      "/life-events",
      "/tax-pack",
      "/taxes",
      "/check-in",
      "/year",
    ],
  },
];

export const SETTINGS_TAB: Tab = {
  key: "settings",
  label: "Settings",
  href: "/settings",
  paths: ["/settings", "/connect", "/import"],
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
