import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// What Chrome and Lighthouse need for an installable app: a name, a start URL, standalone
// display, a theme colour, 192px and 512px icons (one maskable), and a service worker with
// a fetch handler that serves something offline.
describe("installable app", () => {
  const m = manifest();

  it("has the manifest fields installability needs", () => {
    expect(m).toMatchObject({
      name: expect.any(String),
      short_name: expect.any(String),
      start_url: "/home",
      display: "standalone",
      theme_color: expect.stringMatching(/^#/),
      background_color: expect.stringMatching(/^#/),
    });
    const sizes = (m.icons ?? []).map((i) => `${i.sizes} ${i.type} ${i.purpose}`);
    expect(sizes).toEqual(
      expect.arrayContaining([
        "192x192 image/png any",
        "512x512 image/png any",
        "512x512 image/png maskable",
      ]),
    );
  });

  it("has a service worker that serves the offline page and handles notifications", () => {
    const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    expect(sw).toContain('addEventListener("fetch"');
    expect(sw).toContain('const OFFLINE_URL = "/offline"');
    expect(sw).toContain('addEventListener("push"');
    expect(existsSync(join(process.cwd(), "src/app/offline/page.tsx"))).toBe(true);
  });

  it("never caches pages with people's data", () => {
    const sw = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    // The only thing ever put in the cache is the offline page.
    expect(sw.match(/cache\.(add|put)\w*\(/g)).toEqual(["cache.add("]);
  });
});
