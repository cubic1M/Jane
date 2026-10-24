import { QUIET_END_HOUR, QUIET_START_HOUR } from "@/config/agent-chat";
import { CHAT_EMAILS_PER_DAY, CHAT_NOTIFY_DAILY_LIMIT } from "@/config/chat-notify";

// "Messages from Jane" in Settings: how many go out and when, as notify.ts sends them. Phone
// notifications have a daily cap; email puts what can wait into one email a day, and urgent
// messages (a bill to pay, a paycheck that stopped) go right away (real-user QA, #643).

export const clock = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`;

const emails = (n: number) => (n === 1 ? "one email" : `up to ${n} emails`);

export function messagesFromJaneWords(): string {
  return [
    "When I post something important in your chat, I can send it to you, with buttons to answer right there.",
    `Phone notifications: at most ${CHAT_NOTIFY_DAILY_LIMIT} a day.`,
    `Email: what can wait comes together in ${emails(CHAT_EMAILS_PER_DAY)} a day, and something urgent, like a bill to pay or a paycheck that stopped, comes right away.`,
    `Never between ${clock(QUIET_START_HOUR)} and ${clock(QUIET_END_HOUR)}, and never something you've already seen.`,
  ].join(" ");
}
