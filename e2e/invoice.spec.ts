import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Reading a pasted invoice on /invoice (founder 11-24): "why did I pay $100 to Vercel?" says the bank's
// line can't say why, and the invoice can. The text is read here and not kept.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("pasting an invoice's text lists its line items and total", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/invoice");
  await expect(page.getByRole("heading", { name: "Read an invoice" })).toBeVisible();
  await expect(page.getByText("not a PDF or a picture", { exact: false })).toBeVisible();

  await page
    .getByLabel("The invoice's text")
    .fill("Pro plan  $20.00\nBandwidth overage, 150 GB  $60.00\nTotal  $80.00");
  await page.getByRole("button", { name: "Read it" }).click();

  const result = page.getByRole("status");
  await expect(result).toContainText("The invoice lists 2 lines:");
  await expect(result).toContainText("Pro plan ($20.00)");
  await expect(result).toContainText("Bandwidth overage, 150 GB ($60.00)");
  await expect(result).toContainText("Together they come to $80.00, its total.");
});

test("says what it can't read, with no invoice's lines in the text", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/invoice");
  await page.getByLabel("The invoice's text").fill("Thanks for your business!");
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "can't be read here" })).toContainText(
    "copy the invoice's text out of it and paste that",
  );
});
