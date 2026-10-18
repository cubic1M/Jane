import { describe, expect, it } from "vitest";
import { ACTIVE_NOW_MINUTES } from "@/config/sessions";
import { describeDevice, lastActiveLabel } from "./devices";

// Real user agents, trimmed to what matters.
const AGENTS = {
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  windowsOpera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0",
};

describe("describeDevice", () => {
  it.each([
    [AGENTS.iPhoneSafari, "iPhone · Safari"],
    [AGENTS.iPhoneChrome, "iPhone · Chrome"],
    [AGENTS.iPad, "iPad · Safari"],
    [AGENTS.macChrome, "Mac · Chrome"],
    [AGENTS.macSafari, "Mac · Safari"],
    [AGENTS.macFirefox, "Mac · Firefox"],
    [AGENTS.windowsEdge, "Windows · Edge"],
    [AGENTS.windowsChrome, "Windows · Chrome"],
    [AGENTS.windowsOpera, "Windows · Opera"],
    [AGENTS.androidChrome, "Android · Chrome"],
    [AGENTS.androidSamsung, "Android · Samsung Internet"],
    [AGENTS.linuxFirefox, "Linux · Firefox"],
    [AGENTS.chromebook, "Chromebook · Chrome"],
  ])("names %s", (agent, name) => {
    expect(describeDevice(agent)).toBe(name);
  });

  it("says so when it can't tell", () => {
    expect(describeDevice(null)).toBe("Unknown device");
    expect(describeDevice(undefined)).toBe("Unknown device");
    expect(describeDevice("")).toBe("Unknown device");
    expect(describeDevice("curl/8.6.0")).toBe("Unknown device");
  });

  it("names what it can when only part is known", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0)")).toBe("Windows");
  });
});

describe("lastActiveLabel", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("reads roughly, never to the second", () => {
    expect(lastActiveLabel(now, now)).toBe("Active now");
    expect(lastActiveLabel(ago(ACTIVE_NOW_MINUTES - 1), now)).toBe("Active now");
    expect(lastActiveLabel(ago(ACTIVE_NOW_MINUTES), now)).toBe(`${ACTIVE_NOW_MINUTES} minutes ago`);
    expect(lastActiveLabel(ago(60), now)).toBe("An hour ago");
    expect(lastActiveLabel(ago(5 * 60), now)).toBe("5 hours ago");
    expect(lastActiveLabel(ago(30 * 60), now)).toBe("Yesterday");
    expect(lastActiveLabel(ago(3 * 24 * 60), now)).toBe("3 days ago");
    expect(lastActiveLabel(ago(10 * 24 * 60), now)).toBe("2026-10-08");
  });
});
