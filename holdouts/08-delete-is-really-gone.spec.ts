import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import {
  exportText,
  newPerson,
  pageText,
  personWithStatement,
  settled,
  submitStatementAtHome,
  visit,
} from "./person";
import { chaseChecking, monthly, ordinaryLife } from "./statements";

async function openDeleteForm(page: Page): Promise<void> {
  await visit(page, "/settings");
  await page.getByText("Your data", { exact: false }).first().click();
  await page.getByText("Delete all my data").first().click();
}

/** Coming back: every old address, from the old browser and with the old cookie in a new one. */
async function expectNothingLeft(
  browser: Browser,
  baseURL: string,
  context: BrowserContext,
  oldCookies: Cookie[],
  addresses: string[],
): Promise<void> {
  const elsewhere = await newPerson(browser, baseURL);
  await elsewhere.addCookies(oldCookies);

  for (const visitor of [context, elsewhere]) {
    const page = await visitor.newPage();
    for (const address of addresses) {
      await page.goto(address);
      await settled(page);
      const text = await pageText(page);
      expect(text, `${address} shows none of it`).not.toMatch(
        /netflix|maple court|corner grocery|northwind/i,
      );
      expect(text, `${address} shows none of the amounts`).not.toContain("$15.49");
    }
    const download = await visitor.request.get("/api/export", { maxRedirects: 0 });
    expect(download.status(), "the export is shut").toBeGreaterThanOrEqual(400);
    expect(await download.text()).not.toMatch(/netflix/i);
    await page.close();
  }
  await elsewhere.close();
}

test.describe("Deleting everything", () => {
  test("Delete all my data: a confirmation, then nothing on a return visit", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...monthly("NETFLIX.COM", -1549)]),
    );
    await page
      .getByRole("link", { name: /netflix/i })
      .first()
      .click();
    await page.waitForURL(/\/report\/.+/);
    const finding = new URL(page.url()).pathname;

    // A slip doesn't delete anything.
    await openDeleteForm(page);
    const confirm = page.getByRole("textbox", { name: /delete/i });
    await confirm.fill("delete it");
    await page.getByRole("button", { name: /delete all my data/i }).click();
    await settled(page);
    expect(await exportText(context)).toMatch(/NETFLIX\.COM/);

    // The real thing, and the page the privacy policy promises afterwards.
    await openDeleteForm(page);
    await page.getByRole("textbox", { name: /delete/i }).fill("DELETE");
    const oldCookies = await context.cookies();
    await page.getByRole("button", { name: /delete all my data/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/settings"));
    await settled(page);
    expect(await pageText(page)).toMatch(/deleted/i);

    await expectNothingLeft(browser, baseURL!, context, oldCookies, [
      finding,
      "/report",
      "/transactions",
      "/subscriptions",
      "/settings",
    ]);

    // Starting again in that browser is a new start: none of the old rows come back.
    const restart = await submitStatementAtHome(
      context,
      chaseChecking([
        { daysAgo: 9, description: "HARBOR HARDWARE", cents: -2750 },
        { daysAgo: 40, description: "HARBOR HARDWARE", cents: -1320 },
      ]),
    );
    await restart.waitForURL(/\/report/, { timeout: 60_000 });
    const fresh = await exportText(context);
    expect(fresh).toMatch(/HARBOR HARDWARE/);
    expect(fresh).not.toMatch(/netflix|maple court|corner grocery|northwind/i);

    await context.close();
  });

  test("Start over on a statement try: gone the same way", async ({ browser, baseURL }) => {
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...monthly("NETFLIX.COM", -1549)]),
    );
    await page
      .getByRole("link", { name: /netflix/i })
      .first()
      .click();
    await page.waitForURL(/\/report\/.+/);
    const finding = new URL(page.url()).pathname;

    const oldCookies = await context.cookies();
    await page
      .getByRole("button", { name: /start over/i })
      .first()
      .click();
    await page.waitForURL((url) => !url.pathname.startsWith("/report"));
    await settled(page);

    await expectNothingLeft(browser, baseURL!, context, oldCookies, [
      finding,
      "/report",
      "/transactions",
    ]);

    await context.close();
  });
});
