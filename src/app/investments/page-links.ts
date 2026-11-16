import type { Route } from "next";
import { isHiddenPage } from "@/config/hidden-pages";

type PageLink = { href: Route; label: string };

const PRACTICE: PageLink = { href: "/investments/practice", label: "Practice portfolio" };
const PAGES: readonly PageLink[] = [
  { href: "/investments/review", label: "Portfolio review" },
  { href: "/investments/fees", label: "Fees" },
  { href: "/investments/profile", label: "Investor profile" },
];

// The investing pages linked under the heading. The practice portfolio only where it opens (demo
// advice): a real account was offered it and got a page saying it's demo only (gate A crawl, 11-15).
export function investingPageLinks(practiceOpen: boolean): PageLink[] {
  return [...(practiceOpen ? [PRACTICE] : []), ...PAGES].filter((n) => !isHiddenPage(n.href));
}
