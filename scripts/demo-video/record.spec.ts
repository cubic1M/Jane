import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { TERMS_VERSION } from "../../src/config/legal";
import { caption, clickOn, glide, glideTo, installOverlay, moveTo, touchDot } from "./overlay";
import { sampleStatement } from "./sample-statement";
import { demoDatabaseUrl } from "./settings";

// Records the product demo (./README.md): landing → upload a statement → the import finishing →
// findings with their dollars and how sure Jane is → one finding's steps → the checkup → change
// alerts → the net-worth home. Sample data only, on the scratch database; no Claude call.

const OUT = path.join(__dirname, "out");
// Stills of each step, to look over a run for spinners or glitches without playing the video.
const STILLS = path.join(OUT, "stills");

const SHOTS = [
  { name: "desktop", viewport: { width: 1280, height: 720 }, scale: 1, touch: false },
  // A phone at twice the pixels, so text stays sharp in the file (780x1688).
  { name: "phone", viewport: { width: 390, height: 844 }, scale: 2, touch: true },
] as const;

// A made-up person with a signed-in session (the terms already accepted), as e2e/db.ts does.
async function demoPerson(): Promise<{ userId: string; sessionToken: string }> {
  const id = crypto.randomUUID().replaceAll("-", "");
  const userId = `demo${id}`;
  const sessionToken = `demo-session-${id}`;
  const client = new Client({ connectionString: demoDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, name, role, terms_version, terms_accepted_at, updated_at)
       VALUES ($1, $2, 'Sam', 'user', $3, now(), now())`,
      [userId, `${userId}@example.test`, TERMS_VERSION],
    );
    await client.query(
      `INSERT INTO sessions (id, session_token, user_id, expires)
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [`s${id}`, sessionToken, userId],
    );
  } finally {
    await client.end();
  }
  return { userId, sessionToken };
}

async function deletePerson(userId: string) {
  const client = new Client({ connectionString: demoDatabaseUrl() });
  await client.connect();
  try {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  } finally {
    await client.end();
  }
}

for (const shot of SHOTS) {
  test(`demo video, ${shot.name}`, async ({ browser, baseURL }) => {
    fs.mkdirSync(STILLS, { recursive: true });
    const person = await demoPerson();
    const size = {
      width: shot.viewport.width * shot.scale,
      height: shot.viewport.height * shot.scale,
    };
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: shot.scale,
      isMobile: shot.touch,
      hasTouch: shot.touch,
      colorScheme: "light",
      reducedMotion: "no-preference",
      recordVideo: { dir: path.join(OUT, "raw"), size },
    });
    const started = Date.now();
    const page = await context.newPage();
    await installOverlay(page, { touch: shot.touch });
    let step = 0;
    const still = async (label: string) => {
      step += 1;
      await page.screenshot({
        path: path.join(STILLS, `${shot.name}-${String(step).padStart(2, "0")}-${label}.png`),
      });
    };
    const story = new Story(page, shot.touch);
    let trimStart = 0;
    // Jane brings each finding as a card beside the chat (a computer's dock), with how sure it
    // is under the headline. The chat refreshes when the import finishes and the dock follows.
    // Shown once, on the finding, else on Home.
    let shownSure = false;
    const howSure = async (after: string, timeout: number) => {
      const sure = page.locator("[data-card-sure]").first();
      if (shot.touch || shownSure) return;
      if (
        !(await sure.waitFor({ timeout }).then(
          () => true,
          () => false,
        ))
      )
        return;
      shownSure = true;
      await caption(page, "Jane brings it to you, with how sure it is");
      await moveTo(page, sure, { steps: 24 });
      await page.waitForTimeout(3_000);
      await still("suggestion-sure");
      await caption(page, after);
      await page.waitForTimeout(800);
    };

    try {
      // 1. The landing page.
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      trimStart = (Date.now() - started) / 1000;
      await caption(page, "Jane: your AI financial controller");
      await page.mouse.move(shot.viewport.width * 0.62, shot.viewport.height * 0.55, { steps: 30 });
      await still("landing");
      await page.waitForTimeout(3_000);
      await glide(page, shot.viewport.height * 0.6, { ms: 1_800 });
      await glide(page, -shot.viewport.height * 0.6, { ms: 1_200 });

      // 2. Upload a statement (signed in with an invite, off camera).
      await context.addCookies([
        { name: "authjs.session-token", value: person.sessionToken, url: baseURL ?? "" },
      ]);
      await page.goto("/import");
      await caption(page, "Upload a bank statement");
      await expect(page.getByRole("heading", { name: "Upload statement files" })).toBeVisible();
      await story.settle();
      await still("import");
      await page.waitForTimeout(1_200);
      const file = page.locator('input[type="file"]');
      const statement = {
        name: "chase-checking-statement.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(sampleStatement()),
      };
      // Picked the way a person picks it: a click on the file button opens the chooser.
      const chooser = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
      await story.click(file);
      const picked = await chooser;
      if (picked) await picked.setFiles(statement);
      else await file.setInputFiles(statement);
      await page.waitForTimeout(900);
      await story.click(page.getByRole("button", { name: "Preview" }));
      const importButton = page.getByRole("button", { name: /^Import \d+ transactions$/ });
      await expect(importButton).toBeVisible();
      await page.waitForTimeout(2_000);
      await still("preview");

      // 3. The import finishes in a few seconds.
      await story.click(importButton);
      await caption(page, "Four months read in seconds");
      const saved = page.locator("[data-import-saved]");
      await expect(saved).toBeVisible({ timeout: 60_000 });
      const run = await saved.getAttribute("data-import-saved");
      await still("saving");
      const done = page.locator(`[data-import-chip="done"][data-import-run="${run}"]`);
      await expect(done).toBeVisible({ timeout: 120_000 });
      await page.waitForTimeout(1_500);
      await still("imported");
      // 4. The findings, with dollars and how sure Jane is.
      await story.click(done.getByRole("link", { name: "See findings" }));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^We found \$/, {
        timeout: 60_000,
      });
      await caption(page, "Jane finds the leaks");
      await story.settle();
      await still("report");
      await page.waitForTimeout(1_200);
      const top = page.getByRole("list", { name: "What matters now" }).getByRole("link");
      for (const n of [0, 1, 2]) {
        await moveTo(page, top.nth(n), { steps: 18 });
        await page.waitForTimeout(800);
      }
      await caption(page, "Each with how sure Jane is");
      await moveTo(page, top.first().locator("[data-finding-sure]"), { steps: 18 });
      await page.waitForTimeout(2_000);

      // 5. One finding and its steps.
      await story.click(top.first());
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/^We found/);
      await caption(page, "The proof, and what to do");
      await page.waitForTimeout(2_500);
      await still("finding");
      await howSure("The proof, and what to do", 8_000);
      const showHow = page.getByRole("button", { name: /^Show me how/ });
      await glideTo(page, page.getByRole("heading", { name: "Why we think so" }), { ms: 1_800 });
      await page.waitForTimeout(1_500);
      await story.click(showHow);
      await page.waitForTimeout(1_200);
      await glide(page, shot.viewport.height * 0.5, { ms: 1_600 });
      await page.waitForTimeout(2_000);
      await still("finding-steps");

      // 6. The checkup: every check Jane ran.
      await story.click(page.getByRole("link", { name: "‹ Back to your report" }));
      const checkup = page.locator("[data-checkup]");
      await expect(checkup).toBeVisible();
      await caption(page, "Every check Jane ran, with its number");
      await page.waitForTimeout(800);
      await glideTo(page, checkup, { offset: shot.touch ? 70 : 130, ms: 1_800 });
      await still("checkup");
      await page.waitForTimeout(1_200);
      // A passed line opens to say what Jane looked at.
      await story.click(checkup.locator('[data-check="passed"] summary').first());
      await page.waitForTimeout(2_500);
      await still("checkup-open");

      // 7. Change alerts, each with how sure Jane is.
      // No page links here but Home, so the app's own router opens it, as a link would: no
      // full reload, so the chat beside it stays put.
      await story.open("/jane");
      await caption(page, "Then it keeps watching for changes");
      const alerts = page.locator("#alerts");
      await expect(alerts).toBeVisible();
      await story.settle();
      // New alerts show without a tap.
      await glideTo(page, alerts, { offset: shot.touch ? 70 : 130, ms: 1_500 });
      const alert = alerts.locator("[data-alert-confidence]").first();
      await expect(alert).toBeVisible();
      await moveTo(page, alert, { steps: 20 });
      await page.waitForTimeout(3_000);
      await still("alerts");

      // 8. The net-worth home.
      await story.click(page.getByRole("link", { name: "Home", exact: true }).first());
      await expect(page.getByLabel("Net worth").first()).toBeVisible();
      await caption(page, "Your whole picture, on one home");
      await story.settle();
      await page.waitForTimeout(1_000);
      await still("home");
      await howSure("Your whole picture, on one home", 3_000);
      // Every area Jane looks after, then back up to the net worth.
      const areas = page.locator("[data-giant-tree]").first();
      if (await areas.isVisible()) {
        await glideTo(page, areas, { offset: shot.touch ? 70 : 90, ms: 1_800 });
        await page.waitForTimeout(2_000);
        await still("home-areas");
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
        await page.waitForTimeout(1_400);
      }
      // Scrub the line from four months ago to today, then let go on today's figure.
      const plot = page.locator("[data-net-worth-plot]").first();
      const box = await plot.boundingBox();
      if (box) {
        const y = box.y + box.height * 0.6;
        await touchDot(page, shot.touch);
        await page.mouse.move(box.x + box.width * 0.08, y, { steps: 25 });
        await page.waitForTimeout(500);
        await page.mouse.move(box.x + box.width * 0.995, y, { steps: 90 });
        await page.waitForTimeout(800);
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height + 60, { steps: 20 });
        await touchDot(page, false);
      }
      await page.waitForTimeout(2_200);
      await still("home-today");
      await caption(page, "");
      await page.waitForTimeout(1_000);
    } finally {
      const video = page.video();
      await context.close();
      if (video) {
        await video.saveAs(path.join(OUT, `jane-demo-${shot.name}.webm`));
        await video.delete();
      }
      fs.writeFileSync(
        path.join(OUT, `jane-demo-${shot.name}.json`),
        JSON.stringify({ trimStart, size }, null, 2),
      );
      await deletePerson(person.userId);
    }
  });
}

// Clicks and taps the way a person does, slowly enough to follow.
class Story {
  constructor(
    private page: Page,
    private touch: boolean,
  ) {}

  async click(target: ReturnType<Page["locator"]>) {
    await clickOn(this.page, target, { touch: this.touch });
    await this.page.waitForTimeout(400);
  }

  // Opens a page in place, the way the app's links do (Next's router), else by loading it.
  async open(href: string) {
    const routed = await this.page.evaluate((h) => {
      const router = (window as { next?: { router?: { push(h: string): void } } }).next?.router;
      router?.push(h);
      return Boolean(router);
    }, href);
    if (routed) await this.page.waitForURL(`**${href}`);
    else await this.page.goto(href);
  }

  // Lets the page finish loading (the chat beside it too) before the next move.
  async settle() {
    await this.page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }
}
