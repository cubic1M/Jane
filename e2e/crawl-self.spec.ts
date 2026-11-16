import { expect, test } from "@playwright/test";
import { itemKey, look, pageKey } from "./crawl";

// The dead-end crawl's own checks (e2e/crawl.ts), on pages made here: each kind of dead end is
// found, and a healthy page has none. A crawl that stopped seeing them would pass on anything.

const ORIGIN = "http://localhost:3000";
const page_ = (body: string) =>
  `<html><body><main><header><nav id="main-nav"><a href="/home">Home</a></nav></header>${body}</main></body></html>`;

test("addresses: one per page, focus kept for the item", () => {
  expect(pageKey("/money?focus=coming:x&from=m1#top", ORIGIN)).toBe("/money");
  expect(pageKey("/tax-pack?year=2025&b=1", ORIGIN)).toBe("/tax-pack?b=1&year=2025");
  expect(itemKey("/money?focus=coming:x&from=m1", ORIGIN)).toBe("/money?focus=coming%3Ax");
  expect(pageKey("https://example.com/x", ORIGIN)).toBeNull();
});

test("each kind of dead end is found", async ({ page }) => {
  await page.setContent(
    page_(`
      <h1>Investing</h1>
      <p>The practice portfolio is only available in demo advice mode for now.</p>
      <section><h2>Your goals</h2></section>
      <ul aria-label="Goals"></ul>
      <nav aria-label="Investing pages"></nav>
      <div role="tree" aria-label="Investing"></div>
    `),
  );
  const seen = await look(page);
  const kinds = seen.found.map((f) => `${f.kind}: ${f.detail}`);
  expect(kinds).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^unavailable: The practice portfolio is only available/),
      'empty: heading "Your goals"',
      "empty: list Goals",
      'empty: links "Investing pages"',
      'empty: tree "Investing"',
    ]),
  );
});

test("a page with nothing to press counts none; the header's tabs don't count", async ({
  page,
}) => {
  await page.setContent(page_("<h1>Coming up</h1><p>Rent, $1,200.00</p>"));
  expect((await look(page)).pressable).toBe(0);
});

test("a healthy page has no findings", async ({ page }) => {
  await page.setContent(
    page_(`
      <h1>Spending &amp; bills</h1>
      <section><h2>Coming up</h2><p>Rent, $1,200.00</p><a href="/bills">See the month</a></section>
      <ul><li>Netflix</li></ul>
      <nav aria-label="Spending pages"><a href="/subscriptions">Subscriptions</a></nav>
    `),
  );
  const seen = await look(page);
  expect(seen.found).toEqual([]);
  expect(seen.pressable).toBeGreaterThan(0);
});
