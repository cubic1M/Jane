import { describe, expect, it } from "vitest";
import { isLinkPreview, isPrefetch } from "./try-link";

// A chat app unfurling the /try link, or a browser prefetching it, never makes a sample person.
const headers = (init: Record<string, string>) => new Headers(init);

describe("isLinkPreview", () => {
  it("knows the common link previews and crawlers, and a request with no user agent", () => {
    for (const agent of [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "facebookexternalhit/1.1 Facebot Twitterbot/1.0",
      "WhatsApp/2.23.20.0",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "TelegramBot (like TwitterBot)",
    ]) {
      expect(isLinkPreview(headers({ "user-agent": agent })), agent).toBe(true);
    }
    expect(isLinkPreview(headers({}))).toBe(true);
  });

  it("lets people's browsers through, phones and the test browser included", () => {
    for (const agent of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
    ]) {
      expect(isLinkPreview(headers({ "user-agent": agent })), agent).toBe(false);
    }
  });
});

describe("isPrefetch", () => {
  it("knows a prefetch or prerender by any of the headers browsers send", () => {
    expect(isPrefetch(headers({ "sec-purpose": "prefetch" }))).toBe(true);
    expect(isPrefetch(headers({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetch(headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetch(headers({ "x-moz": "prefetch" }))).toBe(true);
    expect(isPrefetch(headers({ "user-agent": "Safari" }))).toBe(false);
  });
});
