// The main menu (spec step 79): Jane's chat first (spec step 81), then four tabs, with
// Settings behind the profile menu. Every signed-in page belongs to exactly one of them, so
// the right tab lights up wherever the person is. A page's sub-pages (/report/abc,
// /settings/two-factor) belong with it. Ask left the menu for the chat's message box, and
// still lights up Chat.
//
// Spec step 86: the chat is where things happen, and the four tabs are its details. The
// menu shows Chat and a "Details" menu holding Today, Jane, Money and Ahead with every page
// under them (DETAIL_PAGES).

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
      "/investments",
      "/loans",
      "/things",
      "/goals",
      "/budgets",
      "/subscriptions",
      "/bills",
      "/transactions",
      "/insights",
      "/documents",
      "/insurance",
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

// Spec step 86: the tabs behind the Details menu, in menu order.
export const DETAIL_TABS: readonly Tab[] = TABS.filter((tab) => tab.key !== "chat");

// Names for the pages in the Details menu, where the address alone reads badly. A page
// without one is named from its address ("/life-events" is "Life events").
const PAGE_LABELS: Readonly<Record<string, string>> = {
  "/report": "Savings report",
  "/things": "Things you own",
  "/afford": "Can I afford it?",
  "/tax-pack": "Tax-time pack",
  "/check-in": "Monthly check-in",
  "/year": "Year in review",
};

const fromPath = (href: string) => {
  const words = href.slice(1).replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// The pages under each detail tab, as the Details menu lists them under the tab's own page.
// Made from the tabs' paths, so a page added to a tab is in the menu too.
export const DETAIL_PAGES: Readonly<Record<string, readonly { label: string; href: string }[]>> =
  Object.fromEntries(
    DETAIL_TABS.map((tab) => [
      tab.key,
      tab.paths.slice(1).map((href) => ({ href, label: PAGE_LABELS[href] ?? fromPath(href) })),
    ]),
  );

// Whether a page is one of the details (anything under Today, Jane, Money or Ahead).
export const isDetail = (pathname: string) => DETAIL_TABS.some((t) => t.key === tabFor(pathname));
