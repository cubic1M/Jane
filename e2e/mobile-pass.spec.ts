import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crawl, settle } from "./crawl";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { waitForImport } from "./import-wait";
import { phoneLook } from "./mobile-pass";
import { signInWith } from "./session";

// The phone pass, by hand (founder, 11-16: "build the mobile webpage better"). For a real
// account's student (statement uploads) and the demo person: every page they can reach (the gate A
// crawl finds them), plus the landing and sign-up pages, at 375×812 and 390×844, light and dark.
// Each page is photographed whole and looked at (e2e/mobile-pass.ts); Home's first screen, the
// thumb's reach for Yes and Not now, the chat sheet and a slow phone are measured on their own.
//
//   MOBILE_PASS_OUT=<folder> E2E_PROD=1 npx playwright test e2e/mobile-pass.spec.ts --project=chromium
//
// writes <folder>/<person>/<size>-<scheme>/<page>.jpg and <folder>/<person>.json.

const OUT = process.env.MOBILE_PASS_OUT;
test.skip(!OUT || !E2E_DATABASE_URL, "a by-hand pass: set MOBILE_PASS_OUT and E2E_DATABASE_URL");
test.describe.configure({ mode: "parallel" });
test.setTimeout(90 * 60_000);

const SIZES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
];
const SCHEMES = ["light", "dark"] as const;

const phone = (
  browser: Browser,
  size: { width: number; height: number },
  colorScheme: "light" | "dark" = "light",
) =>
  browser.newContext({
    viewport: size,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    colorScheme,
  });
const slug = (key: string) => key.replace(/^\//, "").replace(/[^\w-]+/g, "-") || "landing";
const shot = (page: Page, file: string, fullPage = true) => {
  mkdirSync(join(file, ".."), { recursive: true });
  return page.screenshot({ path: file, fullPage, type: "jpeg", quality: 70 });
};

async function uploaded(context: BrowserContext, page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  await signInWith(context, user.sessionToken, baseURL);
  for (const file of ["e2e/fixtures/messy/checking.csv", "e2e/fixtures/messy/card-aug-oct.csv"]) {
    await page.goto("/import");
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
    await waitForImport(page, { open: "/home" });
  }
  return user;
}

async function demo(context: BrowserContext, page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/connect");
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await expect(page).not.toHaveURL(/\/connect$/, { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);
  return user;
}

// Home's first screen, the thumb's reach and the chat sheet, at one size.
async function homeMeasures(page: Page) {
  await page.goto("/home");
  await settle(page);
  const H = page.viewportSize()!.height;
  const box = async (selector: string) => {
    const el = page.locator(selector).first();
    return (await el.count()) ? await el.boundingBox() : null;
  };
  const netWorth = await box('[data-hub-number="net-worth"]');
  const cards = page.getByRole("region", { name: "Suggestions for you" });
  const folded = cards.locator('[data-card-state="folded"]');
  const foldedBox = (await folded.count()) ? await folded.boundingBox() : null;
  if (foldedBox) await folded.click();
  const showing = cards.locator('[data-card-state="showing"]');
  const yes = (await showing.count())
    ? await showing.getByRole("button", { name: "Yes", exact: true }).boundingBox()
    : null;
  const notNow = (await showing.count())
    ? await showing.getByRole("button", { name: "Not now", exact: true }).boundingBox()
    : null;
  const headline = (await showing.count())
    ? ((await showing.locator("h3").first().textContent()) ?? "").trim()
    : null;
  // The chat sheet: how tall, and where its message box is.
  let sheet: { height: number; inputTop: number | null; inputBottom: number | null } | null = null;
  const open = page.getByRole("button", { name: /^Chat with Jane/ }).first();
  if (await open.count()) {
    await open.click();
    const frame = page.frameLocator("iframe").first();
    const input = frame.getByRole("textbox", { name: "Message Jane" });
    await input.waitFor({ timeout: 30_000 }).catch(() => {});
    const frameBox = await page.locator("iframe").first().boundingBox();
    const inputBox = await input.boundingBox().catch(() => null);
    // A frame locator's box is already on the page's own coordinates.
    sheet = {
      height: Math.round(frameBox?.height ?? 0),
      inputTop: inputBox ? Math.round(inputBox.y) : null,
      inputBottom: inputBox ? Math.round(inputBox.y + inputBox.height) : null,
    };
  }
  const y = (b: { y: number; height: number } | null) =>
    b ? { top: Math.round(b.y), bottom: Math.round(b.y + b.height), ofScreen: H } : null;
  return {
    netWorth: y(netWorth),
    foldedCards: y(foldedBox),
    firstCard: headline,
    yes: y(yes),
    notNow: y(notNow),
    sheet,
  };
}

// A slow phone: what the first seconds look like.
async function slowPhone(
  browser: Browser,
  token: string,
  baseURL: string | undefined,
  dir: string,
) {
  const context = await phone(browser, SIZES[0]);
  await signInWith(context, token, baseURL);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (200 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  for (const path of ["/home", "/money", "/insurance"]) {
    const started = Date.now();
    await page.goto(path, { waitUntil: "commit", timeout: 120_000 });
    for (const after of [1_500, 4_000, 8_000]) {
      // What a person sees at that moment of a slow load: a clock, not a wait for something.
      await new Promise((done) => setTimeout(done, Math.max(0, after - (Date.now() - started))));
      await shot(page, join(dir, "slow", `${slug(path)}-${after}ms.jpg`), false);
    }
    await settle(page);
  }
  await context.close();
}

for (const person of ["upload", "demo"] as const) {
  test(`phone pass: ${person}`, async ({ browser, baseURL, isMobile }) => {
    test.skip(isMobile, "it makes its own phones");
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    const setup = await phone(browser, SIZES[1]);
    const page = await setup.newPage();
    const user =
      person === "upload" ? await uploaded(setup, page, baseURL) : await demo(setup, page, baseURL);
    try {
      const { pages } = await crawl(page, { origin, maxPages: 120, maxDepth: 3 });
      await setup.close();
      const dir = join(OUT!, person);
      const report: Record<string, unknown>[] = [];
      for (const size of SIZES) {
        for (const scheme of SCHEMES) {
          const context = await phone(browser, size, scheme);
          await signInWith(context, user.sessionToken, baseURL);
          const p = await context.newPage();
          for (const key of pages) {
            await p
              .goto(origin + key, { waitUntil: "domcontentloaded", timeout: 90_000 })
              .catch(() => {});
            await settle(p);
            const look = await phoneLook(p);
            await shot(p, join(dir, `${size.width}x${size.height}-${scheme}`, `${slug(key)}.jpg`));
            report.push({ page: key, size: `${size.width}x${size.height}`, scheme, ...look });
          }
          if (scheme === "light") {
            report.push({
              page: "(home measures)",
              size: `${size.width}x${size.height}`,
              ...(await homeMeasures(p)),
            });
            await shot(
              p,
              join(dir, `${size.width}x${size.height}-${scheme}`, "_chat-sheet.jpg"),
              false,
            );
          }
          await context.close();
        }
      }
      await slowPhone(browser, user.sessionToken, baseURL, dir);
      writeFileSync(
        join(OUT!, `${person}.json`),
        JSON.stringify({ person, pages, report }, null, 1),
      );
    } finally {
      await deleteUser(user.userId);
    }
  });
}

test("phone pass: landing and sign-up", async ({ browser, baseURL, isMobile }) => {
  test.skip(isMobile, "it makes its own phones");
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  const report: Record<string, unknown>[] = [];
  for (const size of SIZES) {
    for (const scheme of SCHEMES) {
      const context = await phone(browser, size, scheme);
      const p = await context.newPage();
      for (const key of ["/", "/signup", "/login"]) {
        await p.goto(origin + key, { waitUntil: "domcontentloaded" });
        await p.waitForLoadState("load");
        const look = await phoneLook(p);
        await shot(
          p,
          join(OUT!, "signed-out", `${size.width}x${size.height}-${scheme}`, `${slug(key)}.jpg`),
        );
        report.push({ page: key, size: `${size.width}x${size.height}`, scheme, ...look });
      }
      await context.close();
    }
  }
  writeFileSync(join(OUT!, "signed-out.json"), JSON.stringify({ report }, null, 1));
});
