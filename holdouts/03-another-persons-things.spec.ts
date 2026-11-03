import { expect, test } from "@playwright/test";
import {
  exportText,
  pageText,
  personWithSampleData,
  personWithStatement,
  settled,
  visit,
} from "./person";
import { chaseChecking, monthly, ordinaryLife, SMALL_PDF } from "./statements";

test("A person can't open someone else's finding or document, even with the exact address", async ({
  browser,
  baseURL,
}) => {
  // Someone with a finding.
  const owner = await personWithStatement(
    browser,
    baseURL!,
    chaseChecking([...ordinaryLife(), ...monthly("NETFLIX.COM", -1549)]),
  );
  await owner.page
    .getByRole("link", { name: /netflix/i })
    .first()
    .click();
  await owner.page.waitForURL(/\/report\/.+/);
  const netflixFinding = new URL(owner.page.url()).pathname;
  await expect(owner.page.locator("body")).toContainText("$15.49"); // it is a real address

  // Someone with a document. A temporary try keeps statements only, so this one is a sample person.
  const keeper = await personWithSampleData(browser, baseURL!);
  await visit(keeper.page, "/documents");
  await keeper.page.locator('input[type="file"]').setInputFiles(SMALL_PDF);
  await keeper.page.getByRole("button", { name: /^upload$/i }).click();
  await expect(keeper.page.locator("body")).toContainText(SMALL_PDF.name);
  const download = keeper.page.locator('a[href*="/api/documents/"]').first();
  await expect(download).toBeVisible();
  const documentAddress = (await download.getAttribute("href"))!;
  const own = await keeper.context.request.get(documentAddress);
  expect(own.status(), "the owner opens their own document").toBe(200);
  expect((await own.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Someone else entirely, signed in as themselves.
  const stranger = await personWithStatement(
    browser,
    baseURL!,
    chaseChecking([...ordinaryLife(), ...monthly("SPOTIFY USA", -1199)]),
  );

  await stranger.page.goto(netflixFinding);
  await settled(stranger.page);
  const seen = await pageText(stranger.page);
  expect(seen, "the stranger sees nothing of the finding").not.toMatch(/netflix/i);
  expect(seen).not.toContain("$15.49");
  expect(seen).not.toContain("$185.88");
  expect(seen, "and is told there's nothing here").toMatch(
    /not found|can't find|couldn't find|doesn't exist|isn't here|no such/i,
  );

  // Nor is it in what the server sent, hidden in the page's data.
  const sent = await stranger.context.request.get(netflixFinding);
  const html = await sent.text();
  expect(html).not.toMatch(/netflix/i);
  expect(html).not.toContain("15.49");

  for (const address of [documentAddress, documentAddress.split("?")[0]]) {
    const attempt = await stranger.context.request.get(address, { maxRedirects: 0 });
    expect(attempt.status(), `${address} is refused`).toBeGreaterThanOrEqual(300);
    expect((await attempt.body()).toString("latin1")).not.toContain("%PDF-");
  }

  // Nor does anyone else's data turn up in what they can download.
  const strangersExport = await exportText(stranger.context);
  expect(strangersExport).not.toMatch(/netflix/i);
  expect(strangersExport).not.toContain(SMALL_PDF.name);
  expect(strangersExport).not.toContain("Demo Bank");

  await Promise.all([owner.context.close(), keeper.context.close(), stranger.context.close()]);
});
