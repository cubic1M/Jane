import { DAILY_REPORT_FROM_HOUR, DAILY_REPORT_UNTIL_HOUR } from "@/config/daily-report";
import { localTime } from "@/lib/jane-agent/quiet-hours";

// Whether it is the person's daytime for the daily report: from 7am up to 8pm on their own clock
// (users.timezone, US Pacific when unset). Its own window, not the chat's quiet hours.
export function inReportWindow(now: Date, timezone: string | null | undefined): boolean {
  const { hour } = localTime(now, timezone);
  return hour >= DAILY_REPORT_FROM_HOUR && hour < DAILY_REPORT_UNTIL_HOUR;
}
