import { expect, test } from "@playwright/test";

// Debugger 11-15: on the landing page, a student ticked "I agree to the Terms and Privacy Policy"
// above "Try it with sample data", opened "Try it with your own statement", and found a second,
// empty box asking again. Agreeing once ticks both; unticking either unticks both.

test("agreeing once on the landing page counts for both ways to try", async ({ page }) => {
  await page.goto("/");
  const sample = page.locator("form").filter({ hasText: "Try it with sample data" });
  const own = page.locator("#try-upload");
  await sample.getByRole("checkbox").check();
  await own.locator("summary").click();
  await expect(own.getByRole("checkbox")).toBeChecked();
  await own.getByRole("checkbox").uncheck();
  await expect(sample.getByRole("checkbox")).not.toBeChecked();
});
