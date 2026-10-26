import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The plan shows what matters and hides the rest (founder: "show what matters, hide the rest";
// docs/design/area-pages.md): the three that matter most open, everything else behind "more".
// A Yes is instant and stays (founder, 2026-10-25): marked, No greyed, and Revert puts it back.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the plan opens with three, the rest behind more, and a Yes is instant with Revert", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/plan");
  const top = page.getByRole("region", { name: "What matters now" });
  await expect(top).toBeVisible({ timeout: 60_000 });
  await expect(top.locator("[data-plan-item]")).toHaveCount(3);
  // Everything else is folded away, not open.
  const more = page.locator("[data-plan-more]");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(more.locator("summary")).toHaveText(/^\d+ more on your plan$/);
  await expect(more.locator("[data-plan-item]").first()).toBeHidden();
  for (const section of ["Go ahead with several at once"]) {
    await expect(page.getByText(section, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "This week, Jane will" })).toBeHidden();

  // Yes: marked within 150 ms, No greyed and off, Revert offered.
  const item = top.locator("[data-plan-item]").first();
  const yes = item.getByRole("button", { name: /^Yes\b/ });
  const no = item.getByRole("button", { name: /^No\b/ });
  const started = Date.now();
  await yes.click();
  await expect(yes).toHaveAttribute("aria-pressed", "true", { timeout: 150 });
  expect(Date.now() - started).toBeLessThan(1_000);
  await expect(yes).toHaveAccessibleName(/chosen$/);
  await expect(no).toBeDisabled();
  await expect(no).toHaveAttribute("aria-pressed", "false");
  await expect(item.getByRole("status")).toContainText("Approved");

  // Revert: Yes and No open again at once.
  await item.getByRole("button", { name: /^Revert/ }).click();
  await expect(yes).toBeEnabled({ timeout: 150 });
  await expect(no).toBeEnabled();
  // Either taken back, or (when Jane's work had already started) put back with one line.
  await expect
    .poll(async () => {
      if (await item.getByRole("alert").count()) return "alert";
      return (await yes.isEnabled()) ? "open" : "";
    })
    .toMatch(/open|alert/);
});
