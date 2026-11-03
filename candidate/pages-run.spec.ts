import { expect, test } from "@playwright/test";

// What only a real browser sees. A nonce mistake once left every script on the landing page unable
// to run, and every HTTP check still passed (docs/security/edge.md).
for (const path of ["/", "/login"]) {
  test(`${path} runs with nothing blocked`, async ({ page }) => {
    const blocked: string[] = [];
    const crashed: string[] = [];
    page.on("console", (message) => {
      if (/content security policy/i.test(message.text()))
        blocked.push(message.text().slice(0, 200));
    });
    page.on("pageerror", (error) => crashed.push(error.name));
    await page.goto(path);
    // React has taken the page over only if its scripts ran.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(document.querySelector("body *") ?? {}).some((key) =>
            key.startsWith("__react"),
          ),
        ),
      )
      .toBe(true);
    expect(blocked).toEqual([]);
    expect(crashed).toEqual([]);
  });
}
