import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { HIDDEN_PAGES, hiddenPage, hiddenRedirects, isHiddenPage, shownHref } from "./hidden-pages";

// The pages the read-only beta hides (founder, 2026-10-26): kept in the code, redirected to
// their area page, and brought back by deleting their line.

const APP = join(__dirname, "..", "app");
const pageFile = (path: string) =>
  join(
    APP,
    ...path
      .split("/")
      .filter(Boolean)
      .map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s)),
    "page.tsx",
  );

// Every page in src/app, as a path ("/loans/apply/:id").
function pages(dir = APP, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (name === "page.tsx")
      out.push(
        `/${relative(APP, dir)
          .split("/")
          .filter((s) => s && !/^\(.*\)$/.test(s))
          .map((s) => s.replace(/^\[(.+)\]$/, ":$1"))
          .join("/")}`,
      );
  }
  return out;
}

describe("the hidden pages", () => {
  it("are real pages, each listed once, each going to a page that isn't hidden", () => {
    const paths = HIDDEN_PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of HIDDEN_PAGES) {
      expect(existsSync(pageFile(p.path)), p.path).toBe(true);
      expect(existsSync(pageFile(p.to)), p.to).toBe(true);
      expect(isHiddenPage(p.to), p.to).toBe(false);
    }
  });

  it("are the founder's list: the pages kept stay, and investing keeps three", () => {
    for (const kept of [
      "/investments",
      "/investments/practice",
      "/investments/practice/settings",
      "/loans",
      "/loans/cards",
      "/loans/student",
      "/loans/mortgage",
      "/loans/refinance",
      "/taxes",
      "/taxes/tags",
      "/taxes/calendar",
      "/tax-pack",
      "/insurance",
      "/insurance/quotes",
      "/insurance/checkup",
      "/insurance/read/abc",
      "/ahead",
      "/goals",
      "/net-worth",
      "/afford",
      "/deadlines",
      "/accountant/abc",
      "/admin/queue",
      "/login",
      "/home",
    ])
      expect(isHiddenPage(kept), kept).toBe(false);
    const investing = pages().filter((p) => p.startsWith("/investments/"));
    expect(investing.filter((p) => !isHiddenPage(p)).sort()).toEqual([
      "/investments/practice",
      "/investments/practice/settings",
    ]);
  });

  it("match their own path, with a token or id, a query or an anchor, and nothing longer", () => {
    expect(hiddenPage("/loans/apply/abc123")).toEqual({ path: "/loans/apply/:id", to: "/loans" });
    expect(hiddenPage("/s/tok?x=1")?.to).toBe("/");
    expect(hiddenPage("/taxes/profile#income")?.to).toBe("/taxes");
    expect(hiddenPage("/investments/family-file")?.path).toBe("/investments/family-file");
    expect(isHiddenPage("/investments/family/x")).toBe(false);
    expect(isHiddenPage("https://example.com/actions")).toBe(false);
    expect(shownHref("/actions")).toBe("/jane");
    expect(shownHref("/loans/cards")).toBe("/loans/cards");
  });

  it("redirect to their area page, for a while (not permanently)", async () => {
    expect(hiddenRedirects()).toContainEqual({
      source: "/loans/apply/:id",
      destination: "/loans",
      permanent: false,
    });
    expect(hiddenRedirects()).toHaveLength(HIDDEN_PAGES.length);
    // next.config.ts serves them.
    expect(await nextConfig.redirects?.()).toEqual(hiddenRedirects());
  });
});
