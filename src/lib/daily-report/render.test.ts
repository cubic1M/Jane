import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyReport, type DailyReport } from "./build";
import { renderDailyReport, reportLink } from "./render";

const LINKS = {
  settings: "https://app.example.com/settings",
  unsubscribe: "https://app.example.com/unsubscribe?token=t&what=daily",
};

const report: DailyReport = {
  subject: "Jane: your daily report, Nov 23",
  title: "Your daily report, Nov 23",
  busy: true,
  sections: [
    {
      heading: "Yesterday, Nov 22",
      items: [{ text: "Largest: Fish <b>& Chips</b> $41.10." }],
    },
    {
      heading: "New from Jane",
      items: [{ text: "Hulu and Netflix overlap (84% sure)", path: "/subscriptions" }],
    },
  ],
};

beforeEach(() => vi.stubEnv("APP_URL", "https://app.example.com"));
afterEach(() => vi.unstubAllEnvs());

describe("renderDailyReport", () => {
  it("renders the text with each page link under its line, and an unsubscribe and a not-advice line", () => {
    const { text, subject } = renderDailyReport(report, LINKS);
    expect(subject).toBe("Jane: your daily report, Nov 23");
    expect(text).toContain(
      "- Hulu and Netflix overlap (84% sure)\n  https://app.example.com/subscriptions?utm_source=digest&utm_medium=email&utm_campaign=daily",
    );
    expect(text).toContain("Not financial advice.");
    expect(text).toContain(`Stop the daily report: ${LINKS.unsubscribe}`);
    expect(text).toContain(`Daily report settings: ${LINKS.settings}`);
  });

  it("escapes what statements say, and has no tracking pixel and no raw address or token in a page link", () => {
    const { html } = renderDailyReport(report, LINKS);
    expect(html).toContain("Fish &lt;b&gt;&amp; Chips&lt;/b&gt; $41.10.");
    expect(html).not.toContain("<b>& Chips");
    expect(html).not.toMatch(/<img/);
    expect(html).toContain(`href="${LINKS.unsubscribe.replace("&", "&amp;")}"`);
    // Page links carry only the campaign's tags.
    const pageLinks = [
      ...html.matchAll(/href="(https:\/\/app\.example\.com\/subscriptions[^"]*)"/g),
    ];
    expect(pageLinks.map((m) => m[1])).toEqual([
      "https://app.example.com/subscriptions?utm_source=digest&amp;utm_medium=email&amp;utm_campaign=daily",
    ]);
  });

  it("links only plain pages of the app: anything else goes home", () => {
    expect(reportLink("/taxes/health")).toContain("/taxes/health?");
    for (const path of [
      "https://evil.example.com",
      "//evil.example.com",
      "/a?token=1",
      "javascript:x",
    ]) {
      expect(reportLink(path)).toMatch(/^https:\/\/app\.example\.com\/home\?utm_source=digest/);
    }
  });

  it("renders a quiet day's short report whole", () => {
    const quiet = buildDailyReport({
      today: "2026-11-23",
      spending: {
        day: "2026-11-22",
        totalCents: 0,
        purchases: 0,
        largest: [],
        pending: 0,
        usualCents: null,
        unusual: false,
      },
      reach: "2026-11-23",
      bankUpdated: null,
      suggestions: [],
      suggestionsTotal: 0,
      headsUp: [],
      ahead: [],
    });
    expect(renderDailyReport(quiet, LINKS).text).toBe(
      [
        "Your daily report, Nov 23",
        "",
        "Yesterday, Nov 22",
        "- Your accounts showed no spending.",
        "",
        "Today",
        "- Nothing new from Jane today.",
        "",
        "Facts from your own accounts, with how sure Jane is of each. Not financial advice.",
        "You get this because you turned on the daily report in Jane's settings.",
        `Daily report settings: ${LINKS.settings}`,
        `Stop the daily report: ${LINKS.unsubscribe}`,
      ].join("\n"),
    );
  });
});
