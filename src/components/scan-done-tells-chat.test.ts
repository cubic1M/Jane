import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARDS_CHANGED_EVENT, DATA_CHANGED_EVENT } from "@/config/side-chat";
import { announceScanned } from "@/lib/side-chat";

// Debugger 11-12: a new person linked a bank, the first scan finished, and the page reloaded its
// numbers, but Jane's card dock stayed empty until they reloaded: it had loaded its cards when
// the page opened, mid-scan, and only looked again a minute later. So the yes/no card Jane is
// for never showed at the end of the first sync. Every page that reloads when the first scan
// finishes also tells the side chat and the dock.

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

describe("the end of the first scan", () => {
  const refreshers = files("src").filter((path) => {
    const text = readFileSync(path, "utf8");
    return text.includes("/api/detection/status") && text.includes("router.refresh()");
  });

  it("is found in the scan bar and the report", () => {
    expect(refreshers).toEqual(
      expect.arrayContaining([
        join("src", "components", "scan-bar.tsx"),
        join("src", "app", "report", "refresh-when-scanned.tsx"),
      ]),
    );
  });

  it("reloads the side chat and Jane's cards wherever a page reloads for it", () => {
    const silent = refreshers.filter(
      (path) => !readFileSync(path, "utf8").includes("announceScanned()"),
    );
    expect(silent).toEqual([]);
  });

  it("tells both the framed chat and the card dock", () => {
    const heard: string[] = [];
    const target = new EventTarget();
    for (const type of [DATA_CHANGED_EVENT, CARDS_CHANGED_EVENT])
      target.addEventListener(type, () => heard.push(type));
    announceScanned(target);
    expect(heard).toEqual([DATA_CHANGED_EVENT, CARDS_CHANGED_EVENT]);
  });
});
