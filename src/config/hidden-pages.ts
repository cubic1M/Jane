// Pages the read-only closed beta can't use (founder, 2026-10-26): hidden, with their code and
// data kept. A hidden page redirects to its area page (next.config.ts), and nothing links to
// it: Jane's links land on the area page instead (src/lib/area-pages/landing.ts), and the
// trees, tiles and menus leave it out. To bring a page back, delete its line.
// ":name" is one path segment (a token or an id).

export type HiddenPage = { path: string; to: string };

export const HIDDEN_PAGES: readonly HiddenPage[] = [
  // Investing: /investments, the practice portfolio and its settings stay.
  { path: "/investments/accounts", to: "/investments" },
  { path: "/investments/auto", to: "/investments" },
  { path: "/investments/cash", to: "/investments" },
  { path: "/investments/college", to: "/investments" },
  { path: "/investments/company-stock", to: "/investments" },
  { path: "/investments/costly-products", to: "/investments" },
  { path: "/investments/crypto", to: "/investments" },
  { path: "/investments/family", to: "/investments" },
  { path: "/investments/family-file", to: "/investments" },
  { path: "/investments/fees", to: "/investments" },
  { path: "/investments/goals", to: "/investments" },
  { path: "/investments/hsa", to: "/investments" },
  { path: "/investments/location", to: "/investments" },
  { path: "/investments/old-accounts", to: "/investments" },
  { path: "/investments/performance", to: "/investments" },
  { path: "/investments/plan-menu", to: "/investments" },
  { path: "/investments/profile", to: "/investments" },
  { path: "/investments/property", to: "/investments" },
  { path: "/investments/rebalance", to: "/investments" },
  { path: "/investments/retirement", to: "/investments" },
  { path: "/investments/retirement-accounts", to: "/investments" },
  { path: "/investments/retirement-income", to: "/investments" },
  { path: "/investments/review", to: "/investments" },
  { path: "/investments/short-term", to: "/investments" },
  { path: "/investments/sudden-money", to: "/investments" },
  { path: "/investments/values", to: "/investments" },
  // Loans: /loans, cards, student, mortgage, refinance (and interest) stay.
  { path: "/loans/auto", to: "/loans" },
  { path: "/loans/borrow", to: "/loans" },
  { path: "/loans/car", to: "/loans" },
  { path: "/loans/costly", to: "/loans" },
  { path: "/loans/equity", to: "/loans" },
  { path: "/loans/family", to: "/loans" },
  { path: "/loans/goal", to: "/loans" },
  { path: "/loans/help", to: "/loans" },
  { path: "/loans/helping", to: "/loans" },
  { path: "/loans/home", to: "/loans" },
  { path: "/loans/medical", to: "/loans" },
  { path: "/loans/recast", to: "/loans" },
  { path: "/loans/renting", to: "/loans" },
  { path: "/loans/report", to: "/loans" },
  { path: "/loans/review", to: "/loans" },
  { path: "/loans/tight", to: "/loans" },
  { path: "/loans/credit", to: "/loans" },
  { path: "/loans/apply/:id", to: "/loans" },
  // Taxes: /taxes, tags, the calendar and the tax pack stay.
  { path: "/taxes/accountant", to: "/taxes" },
  { path: "/taxes/business", to: "/taxes" },
  { path: "/taxes/disasters", to: "/taxes" },
  { path: "/taxes/draft", to: "/taxes" },
  { path: "/taxes/equity", to: "/taxes" },
  { path: "/taxes/file", to: "/taxes" },
  { path: "/taxes/health", to: "/taxes" },
  { path: "/taxes/identity", to: "/taxes" },
  { path: "/taxes/inherited", to: "/taxes" },
  { path: "/taxes/last-return", to: "/taxes" },
  { path: "/taxes/letters", to: "/taxes" },
  { path: "/taxes/profile", to: "/taxes" },
  { path: "/taxes/property", to: "/taxes" },
  { path: "/taxes/retirement", to: "/taxes" },
  { path: "/taxes/self-employed", to: "/taxes" },
  { path: "/taxes/years", to: "/taxes" },
  // Insurance: /insurance, quotes, the checkup and a read document stay.
  { path: "/insurance/benefits", to: "/insurance" },
  { path: "/insurance/claims", to: "/insurance" },
  { path: "/insurance/life", to: "/insurance" },
  // Plans & goals: /ahead, goals, net worth, afford and deadlines stay.
  { path: "/what-if", to: "/ahead" },
  { path: "/long-view", to: "/ahead" },
  { path: "/year", to: "/ahead" },
  { path: "/monthly", to: "/ahead" },
  { path: "/life-events", to: "/ahead" },
  { path: "/check-in", to: "/ahead" },
  // Elsewhere.
  { path: "/transfers", to: "/money" },
  { path: "/plan/go", to: "/plan" },
  { path: "/actions", to: "/jane" },
  { path: "/settings/team-access", to: "/settings" },
  { path: "/household", to: "/settings" },
  { path: "/household/join", to: "/home" },
  { path: "/s/:token", to: "/" },
  { path: "/gift/:token", to: "/" },
];

const pattern = (path: string) =>
  new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[a-z]+/gi, "[^/]+")}/?$`);
const MATCHERS = HIDDEN_PAGES.map((p) => ({ ...p, re: pattern(p.path) }));

// The hidden page a link goes to (its path, before any ?query or #anchor), or null.
export function hiddenPage(href: string): HiddenPage | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/, 1)[0];
  const hit = MATCHERS.find((m) => m.re.test(path));
  return hit ? { path: hit.path, to: hit.to } : null;
}

export const isHiddenPage = (href: string) => hiddenPage(href) !== null;

// Buttons that only promise a look: the area page a hidden page's link lands on has that.
export const LOOK_VERBS = ["See", "Check", "Compare", "Review", "Read"] as const;
const LOOK = new RegExp(`^(${LOOK_VERBS.join("|")})\\b`, "i");

// A button that promises a task on a hidden page (founder, 2026-10-30): "Start a claim" can't be
// done on /insurance, where the link would land. A suggestion with one isn't shown while its
// page is hidden (src/lib/suggestions.ts). A look ("See …", "Check your match") stays: the area
// page it lands on has that.
export function promisesHiddenPage(action: { label: string; href: string }): boolean {
  return isHiddenPage(action.href) && !LOOK.test(action.label.trim());
}

// A link as it may be shown: a hidden page's link becomes its area page.
export const shownHref = (href: string) => hiddenPage(href)?.to ?? href;

// For next.config.ts: each hidden page redirects to its area page (not permanent, so a page
// that comes back isn't stuck in browsers' caches).
export function hiddenRedirects() {
  return HIDDEN_PAGES.map((p) => ({ source: p.path, destination: p.to, permanent: false }));
}
