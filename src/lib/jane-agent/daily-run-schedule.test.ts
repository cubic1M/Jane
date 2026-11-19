import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUIET_END_HOUR, QUIET_START_HOUR } from "@/config/agent-chat";
import { TIMEZONES } from "@/config/digest";
import { validTimezone } from "@/lib/digest/week";
import { inQuietHours } from "./quiet-hours";

// Jane's daily chat run (runJaneAgentForAll) comes from a Vercel cron. It posts nothing to someone
// in their quiet hours, and nothing runs it again that day, so the cron's hour (vercel.json) and
// the quiet hours (src/config/agent-chat.ts) have to agree: every timezone offered on /settings
// gets a run outside quiet hours, on standard time and on daylight time. At 15:00 UTC it was 7am
// in Los Angeles (the default) all winter, and earlier still in Alaska and Hawaii all year: no run.

const MINUTE = 60_000;
// Mid-January and mid-July: each offered timezone on its standard time and on its daylight time.
const DAYS = [
  ["January", "2027-01-13"],
  ["July", "2027-07-14"],
] as const;
// Each timezone offered, and someone who never picked one (DEFAULT_TIMEZONE).
const ZONES = [...TIMEZONES, { id: null, label: "no timezone picked" }];

type Cron = { path: string; schedule: string };
const { crons } = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Cron[] };

// The crons whose route runs the chat for everyone, and for how long after the scheduled time a run
// may read its clock: Vercel Hobby starts a daily cron at any minute of its hour ("0 1 * * *" runs
// "anywhere between 1:00 am and 1:59 am", Vercel's cron docs), and the route may reach the chat
// as late as its maxDuration after that.
const chatCrons = crons.flatMap(({ path, schedule }) => {
  const route = readFileSync(`src/app${path}/route.ts`, "utf8");
  if (!route.includes("runJaneAgentForAll(")) return [];
  // Hobby runs a cron at most once a day, so a schedule is one time of day: "M H * * *".
  const time = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule);
  const limit = /export const maxDuration = (\d+);/.exec(route);
  if (!time || !limit) throw new Error(`${path}: expected "M H * * *" and a maxDuration`);
  return [
    {
      path,
      at: Number(time[2]) * 60 + Number(time[1]),
      minutes: 59 + Math.ceil(Number(limit[1]) / 60),
    },
  ];
});

// Every minute of a day (YYYY-MM-DD, UTC) at which a cron's run may read its clock.
const clockReadings = (cron: (typeof chatCrons)[number], day: string) =>
  Array.from(
    { length: cron.minutes + 1 },
    (_, i) => new Date(Date.parse(`${day}T00:00:00Z`) + (cron.at + i) * MINUTE),
  );

const QUIET = `${QUIET_START_HOUR}:00–${String(QUIET_END_HOUR).padStart(2, "0")}:00`;
const hhmm = (at: Date, zone: string | null) =>
  at.toLocaleTimeString("en-GB", {
    timeZone: validTimezone(zone),
    hour: "2-digit",
    minute: "2-digit",
  });

describe("the daily chat run's cron", () => {
  it("is in vercel.json", () => {
    expect(chatCrons.length).toBeGreaterThan(0);
  });

  describe.each(DAYS)("in %s", (_month, day) => {
    it.each(ZONES)("reaches $label outside quiet hours", ({ id: zone }) => {
      const runs = chatCrons.map((cron) => {
        const readings = clockReadings(cron, day);
        return {
          quiet: readings.some((at) => inQuietHours(at, zone)),
          local: `${cron.path} ${hhmm(readings[0], zone)}–${hhmm(readings.at(-1)!, zone)}`,
        };
      });
      expect(
        runs.some((run) => !run.quiet),
        `${zone ?? "default timezone"}, quiet ${QUIET}: ${runs.map((run) => run.local).join(", ")}`,
      ).toBe(true);
    });
  });
});
