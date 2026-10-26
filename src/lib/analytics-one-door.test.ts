import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every funnel event goes through track() (src/lib/analytics.ts), the one place that writes
// analytics_events and, once POSTHOG_KEY is set, sends the same event to PostHog (never for a
// trial person). So no other code writes the table: an event written around it would never
// reach PostHog (docs/setup/posthog.md).

const SRC = join(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("analytics events", () => {
  it("are written only by track(), so each also reaches PostHog", () => {
    const around: string[] = [];
    for (const f of files(SRC)) {
      const where = relative(SRC, f);
      if (where === join("lib", "analytics.ts")) continue;
      const code = readFileSync(f, "utf8");
      if (
        /analyticsEvents?\.(create|createMany|upsert)\b/.test(code) ||
        /insert\s+into\s+"?analytics_events/i.test(code)
      ) {
        around.push(where);
      }
    }
    expect(around).toEqual([]);
  });
});
