import { randomInt } from "node:crypto";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { StatementFile } from "./statements";

// A person is a browser of their own. There is no way to sign up without a real email, so people
// here come in by the two doors on the home page that need none: "your own statement" and "sample
// data". Each gets a visitor address of their own, because those doors limit how often one
// address can use them and these scenarios use them a lot.
export async function newPerson(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const visitor = `10.${randomInt(1, 250)}.${randomInt(0, 250)}.${randomInt(1, 250)}`;
  return browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": visitor } });
}

/** Uploads from the home page's "your own statement" form and leaves the page where it lands. */
export async function submitStatementAtHome(
  context: BrowserContext,
  file: StatementFile,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("summary", { hasText: /your own statement/i }).click();
  const form = page.locator("form").filter({ has: page.locator('input[type="file"]') });
  await form.getByRole("checkbox").check();
  await form.locator('input[type="file"]').setInputFiles(file);
  await form.getByRole("button", { name: /read my statement/i }).click();
  return page;
}

/** A person whose statement was read: they end on their report. */
export async function personWithStatement(
  browser: Browser,
  baseURL: string,
  file: StatementFile,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newPerson(browser, baseURL);
  const page = await submitStatementAtHome(context, file);
  // Either they reach their report, or the page says why not: then the failure says that too.
  const deadline = Date.now() + 60_000;
  while (!/\/report/.test(page.url())) {
    const said = (await page.getByRole("alert").allInnerTexts()).join(" ").trim();
    if (said) throw new Error(`The statement wasn't read. The page says: "${said}"`);
    if (Date.now() > deadline) throw new Error(`Never reached the report, at ${page.url()}`);
    await page.waitForURL(/\/report/, { timeout: 500 }).catch(() => {});
  }
  await settled(page);
  return { context, page };
}

/** A person from the home page's sample data door. */
export async function personWithSampleData(
  browser: Browser,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newPerson(browser, baseURL);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /sample data/i }).click();
  await page.waitForURL((url) => url.pathname !== "/");
  await settled(page);
  return { context, page };
}

/** Waits until what the page shows is what it means to show, before checking something is absent. */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await expect(page.getByText(/·\s*loading/)).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await settled(page);
}

/** What the person reads on the page, without the page's own scripts or styles. */
export async function pageText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

/** The hrefs of a person's findings on their report. */
export async function findingLinks(page: Page): Promise<string[]> {
  await visit(page, "/report");
  const hrefs = await page
    .locator('a[href^="/report/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return [...new Set(hrefs)].filter(Boolean);
}

/** Download my data, as the JSON's text, through the same address the Settings link uses. */
export async function exportText(context: BrowserContext): Promise<string> {
  const response = await context.request.get("/api/export");
  expect(response.status(), "the signed-in person can download their data").toBe(200);
  return response.text();
}
