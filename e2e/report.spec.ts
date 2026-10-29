import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The report shows what matters and hides the rest (founder: "show what matters, hide the
// rest"; docs/design/area-pages.md): the three findings worth the most open, everything else
// behind "more", and the accounts read behind their own closed section.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the report opens with three findings, the rest behind more", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/report");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("We found");
  const top = page.getByRole("list", { name: "What matters now" });
  await expect(top.getByRole("listitem")).toHaveCount(3);
  // Each says how sure Jane is, as the cards do (demo-video list: the list showed none).
  for (const row of await top.getByRole("listitem").all()) {
    await expect(row.locator("[data-finding-sure]")).toHaveText(/^\d+% sure: \S/);
  }
  const more = page.locator("[data-report-more]");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(more.locator("summary")).toHaveText(/^\d+ more to look at$/);
  await expect(more.getByRole("link").first()).toBeHidden();
  await expect(page.getByText(/^Accounts we read \(\d+\)$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Accounts we read" })).toHaveCount(0);
  // Opening "more" shows the rest.
  await more.locator("summary").click();
  await expect(more.getByRole("link").first()).toBeVisible();
  // Under the findings, the checkup: what each check found or passed.
  const checkup = page.locator("[data-checkup]");
  await expect(checkup.locator('[data-check="found"]').first()).toBeVisible();
  await expect(checkup.getByText(/^\d+ of \d+ checks passed$/)).toBeVisible();
});
