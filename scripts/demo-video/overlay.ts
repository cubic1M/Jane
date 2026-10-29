import type { Locator, Page } from "@playwright/test";

// What the video draws on top of the app: a cursor (a recorded browser has none), a ring on
// each click, and a short caption at the bottom. All of it is page DOM added by the recorder,
// never the app's own; it ignores the mouse and survives a page change (sessionStorage).

function install({ touch }: { touch: boolean }) {
  // The page itself, not the chat framed inside it.
  if (window.top !== window) return;
  const KEY = "demo-video-overlay";
  const read = (): { x: number; y: number; caption: string } => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "") as never;
    } catch {
      return { x: -100, y: -100, caption: "" };
    }
  };
  const write = (patch: Partial<ReturnType<typeof read>>) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
    } catch {}
  };
  const ready = () => {
    if (document.getElementById("demo-video-cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #demo-video-cursor { position: fixed; z-index: 2147483647; pointer-events: none;
        left: 0; top: 0; will-change: transform; }
      #demo-video-cursor.touch { width: 34px; height: 34px; margin: -17px 0 0 -17px;
        border-radius: 50%; background: rgba(24,24,27,.28); border: 2px solid rgba(255,255,255,.9);
        box-shadow: 0 1px 6px rgba(0,0,0,.25); }
      .demo-video-ring { position: fixed; z-index: 2147483646; pointer-events: none;
        width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
        border: 3px solid rgba(16,185,129,.9); animation: demo-video-ring .5s ease-out forwards; }
      @keyframes demo-video-ring { from { transform: scale(.3); opacity: 1 }
        to { transform: scale(1.4); opacity: 0 } }
      #demo-video-caption { position: fixed; z-index: 2147483645; pointer-events: none;
        left: 50%; bottom: 28px; transform: translateX(-50%); max-width: calc(100vw - 32px);
        padding: 10px 20px; border-radius: 999px; background: rgba(24,24,27,.88); color: #fff;
        font: 600 20px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif;
        letter-spacing: -.01em; white-space: nowrap; box-shadow: 0 6px 24px rgba(0,0,0,.25);
        transition: opacity .35s ease; }
      #demo-video-caption.empty { opacity: 0; }
      /* A phone: bottom left, clear of the chat button in the corner. */
      @media (max-width: 500px) { #demo-video-caption { font-size: 16px; bottom: 26px; left: 12px;
        transform: none; max-width: calc(100vw - 96px); white-space: normal; padding: 9px 16px; } }
    `;
    document.documentElement.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "demo-video-cursor";
    if (touch) {
      cursor.className = "touch";
    } else {
      // A plain arrow pointer.
      cursor.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M5 2.5v17.2l4.3-4.1 2.8 6.4 2.9-1.3-2.8-6.3h6z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    }
    const caption = document.createElement("div");
    caption.id = "demo-video-caption";
    document.documentElement.append(cursor, caption);

    const place = (x: number, y: number) => {
      cursor.style.transform = touch
        ? `translate(${x}px, ${y}px)`
        : `translate(${x - 5}px, ${y - 2}px)`;
    };
    const saved = read();
    place(saved.x, saved.y);
    caption.textContent = saved.caption;
    caption.classList.toggle("empty", !saved.caption);
    if (touch) cursor.style.opacity = "0";

    addEventListener(
      "mousemove",
      (e) => {
        place(e.clientX, e.clientY);
        write({ x: e.clientX, y: e.clientY });
      },
      true,
    );
    addEventListener(
      "mousedown",
      (e) => {
        const ring = document.createElement("div");
        ring.className = "demo-video-ring";
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        document.documentElement.appendChild(ring);
        setTimeout(() => ring.remove(), 600);
      },
      true,
    );
    // The recorder sets the caption and, on a phone, shows the touch dot only while tapping.
    Object.assign(window, {
      __demoCaption(text: string) {
        caption.textContent = text || caption.textContent;
        caption.classList.toggle("empty", !text);
        write({ caption: text });
      },
      __demoTouch(on: boolean) {
        if (!touch) return;
        cursor.style.transition = "opacity .2s";
        cursor.style.opacity = on ? "1" : "0";
      },
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
}

export async function installOverlay(page: Page, { touch }: { touch: boolean }) {
  await page.addInitScript(install, { touch });
}

export async function caption(page: Page, text: string) {
  await page.evaluate(
    (t) => (window as unknown as { __demoCaption(t: string): void }).__demoCaption(t),
    text,
  );
}

// Glides the cursor to the middle of an element, as a person would, and waits a beat.
export async function moveTo(page: Page, target: Locator, { steps = 28 } = {}) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Nothing to move to");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await page.waitForTimeout(250);
}

// On a phone, shows or hides the finger's dot (while dragging, say). A computer's arrow always
// shows.
export async function touchDot(page: Page, on: boolean) {
  await page
    .evaluate((v) => (window as unknown as { __demoTouch(on: boolean): void }).__demoTouch(v), on)
    .catch(() => {});
}

// Moves there, shows the click, then clicks.
export async function clickOn(page: Page, target: Locator, { touch }: { touch: boolean }) {
  if (touch) await touchDot(page, true);
  await moveTo(page, target);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  if (touch) {
    await page.waitForTimeout(250);
    await touchDot(page, false);
  }
}

// Scrolls the page smoothly by a distance, then lets it settle.
export async function glide(page: Page, by: number, { ms = 900 } = {}) {
  await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), by);
  await page.waitForTimeout(ms);
}

// Smoothly brings an element near the top of the screen.
export async function glideTo(page: Page, target: Locator, { offset = 90, ms = 1_100 } = {}) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Nothing to scroll to");
  await glide(page, box.y - offset, { ms });
}
