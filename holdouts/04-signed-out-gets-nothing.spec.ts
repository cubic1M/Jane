import { expect, test } from "@playwright/test";
import { findingLinks, newPerson, pageText, personWithSampleData, settled, visit } from "./person";
import { SMALL_PDF } from "./statements";

const DATA_PAGES = [
  "/home",
  "/report",
  "/transactions",
  "/subscriptions",
  "/money",
  "/net-worth",
  "/documents",
  "/import",
  "/settings",
  "/chat",
];

test("Signed out, a data page or the export gives nothing", async ({ browser, baseURL }) => {
  // There's someone's data on this server, with addresses a stranger could have been given.
  const person = await personWithSampleData(browser, baseURL!);
  const [finding] = await findingLinks(person.page);
  expect(finding, "the sample person has at least one finding").toBeTruthy();
  await visit(person.page, "/documents");
  await person.page.locator('input[type="file"]').setInputFiles(SMALL_PDF);
  await person.page.getByRole("button", { name: /^upload$/i }).click();
  const link = person.page.locator('a[href*="/api/documents/"]').first();
  await expect(link).toBeVisible();
  const documentAddress = (await link.getAttribute("href"))!;

  // A visitor with no cookies at all.
  const visitor = await newPerson(browser, baseURL!);
  const page = await visitor.newPage();
  for (const path of [...DATA_PAGES, finding!]) {
    await page.goto(path);
    await settled(page);
    const at = new URL(page.url()).pathname;
    expect(at, `${path} sends a signed-out visitor away`).not.toBe(path);
    expect(await pageText(page), `${path} shows no signed-in page`).not.toMatch(
      /Sign out|Your account and settings/,
    );
  }

  const download = await visitor.request.get("/api/export", { maxRedirects: 0 });
  expect(download.status(), "the export refuses a signed-out visitor").toBeGreaterThanOrEqual(400);
  expect(download.status()).toBeLessThan(500);
  const body = await download.text();
  expect(body).not.toMatch(/"transactions"|"accounts"|"profile"/);
  expect(download.headers()["content-disposition"] ?? "").not.toMatch(/attachment/i);

  const followed = await visitor.request.get("/api/export");
  expect(await followed.text()).not.toMatch(/"transactions"|"accounts"/);

  const documentAttempt = await visitor.request.get(documentAddress, { maxRedirects: 0 });
  expect(
    documentAttempt.status(),
    "a document refuses a signed-out visitor",
  ).toBeGreaterThanOrEqual(300);
  expect((await documentAttempt.body()).toString("latin1")).not.toContain("%PDF-");

  await Promise.all([person.context.close(), visitor.close()]);
});
