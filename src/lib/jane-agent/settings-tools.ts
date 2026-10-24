import type Anthropic from "@anthropic-ai/sdk";
import { ALERT_LABELS, ALERT_TYPES } from "@/config/alerts";
import { QUIET_END_HOUR, QUIET_START_HOUR } from "@/config/agent-chat";
import {
  CHAT_NOTIFY_DAILY_LIMIT,
  CHAT_NOTIFY_KIND_LABELS,
  CHAT_NOTIFY_KINDS,
} from "@/config/chat-notify";
import type { PrismaClient } from "@/generated/prisma/client";
import { alertPrefs } from "@/lib/alerts";
import type { ToolOutput } from "@/lib/ask/tools";
import { scopedFor } from "@/lib/db-scoped";
import { twoFactorStatus } from "@/lib/mfa";
import { isDemoItemId } from "@/lib/plaid/demo";
import { isTrialUser } from "@/lib/trial-ids";
import { chatNotifyPrefs } from "./notify-prefs";

// Claude's tools for the person's own setup (gap audit: settings, connected banks,
// notifications): which banks are linked and whether each is still updating, and what Jane sends
// them, where and when. Read-only: changes are made on the settings page, which the answer links
// to (SETTINGS_CHAT_PAGES). Never a bank login, token or account number.

export const SETTINGS_TOOLS: Anthropic.Tool[] = [
  {
    name: "connections",
    description:
      "The person's linked banks and imported files: each bank's name, when it last updated, whether it needs signing in again (then figures from it are out of date until they reconnect on the connected banks page), and its accounts by name and last four digits; CSV imports with their last import. Use for 'my bank stopped updating', 'which accounts are linked', 'connect another bank', 'disconnect my bank'. Linking, refreshing and disconnecting are done on the page: offer the link (page connected_banks, or connect for a new bank).",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "notification_settings",
    description:
      "What Jane sends the person and how: Jane's messages by phone notification and/or email (which kinds, at most a few a day, never in quiet hours), the weekly email and monthly money report (one setting), each alert type (email right away, in the app and weekly email, or off), their timezone, whether two-factor sign-in is on, and whether a money calendar link exists. Someone trying Jane with sample data is never emailed or notified, whatever is set. Read-only: changes are made in settings; offer the matching page (notification_settings, email_settings, alert_settings, two_factor, calendar).",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
];

export const isSettingsTool = (name: string) => SETTINGS_TOOLS.some((t) => t.name === name);

// Pages for these answers (./claude-tools.ts CHAT_PAGES).
export const SETTINGS_CHAT_PAGES: Readonly<Record<string, { label: string; href: string }>> = {
  connected_banks: { label: "Connected banks", href: "/settings#banks" },
  connect: { label: "Connect a bank", href: "/connect" },
  notification_settings: { label: "What Jane sends you", href: "/settings#jane-messages" },
  email_settings: { label: "Email settings", href: "/settings#email" },
  alert_settings: { label: "Alert settings", href: "/settings#alerts" },
  alerts: { label: "See alerts", href: "/alerts" },
  monthly_report: { label: "See the monthly report", href: "/monthly" },
  two_factor: { label: "Two-factor sign-in", href: "/settings/two-factor" },
  sessions: { label: "Where you're signed in", href: "/settings#sessions" },
  who_saw_my_data: { label: "Who saw my data", href: "/settings/team-access" },
  calendar: { label: "Money calendar", href: "/settings#calendar" },
  your_data: { label: "Download my data", href: "/settings#your-data" },
  delete_data: { label: "Delete my data", href: "/settings#delete" },
  memory: { label: "What Jane remembers", href: "/settings#remembers" },
  documents: { label: "Policies and receipts", href: "/documents" },
  things: { label: "Things you own", href: "/things" },
  household: { label: "Household", href: "/household" },
  profile: { label: "What Jane knows about you", href: "/profile" },
};

type Options = { client: PrismaClient; now: Date };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function runSettingsTool(
  userId: string,
  name: string,
  _input: unknown,
  { client }: Options,
): Promise<ToolOutput> {
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents: [] });
  const db = scopedFor(userId, client);

  if (name === "connections") {
    const [items, csv] = await Promise.all([
      db.plaidItems.findMany({
        select: {
          plaidItemId: true,
          institutionName: true,
          status: true,
          lastSyncedAt: true,
          accounts: { select: { name: true, mask: true }, orderBy: { name: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.accounts.findMany({
        where: { source: "csv" },
        select: { name: true, mask: true, updatedAt: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return out({
      banks: items.map((i) => ({
        name: i.institutionName ?? "Your bank",
        sampleData: isDemoItemId(i.plaidItemId),
        lastUpdated: day(i.lastSyncedAt),
        needsSigningInAgain: i.status === "login_required",
        status: i.status,
        accounts: i.accounts.map((a) => (a.mask ? `${a.name} ····${a.mask}` : a.name)),
      })),
      csvImports: csv.map((a) => ({
        account: a.mask ? `${a.name} ····${a.mask}` : a.name,
        lastImport: day(a.updatedAt),
      })),
      page: "connected_banks",
    });
  }

  if (name === "notification_settings") {
    const [user, twoFactor, devices] = await Promise.all([
      client.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          digestEnabled: true,
          alertPrefs: true,
          chatNotifyPrefs: true,
          timezone: true,
          calendarCreatedAt: true,
        },
      }),
      twoFactorStatus(userId, { client }),
      db.pushSubscriptions.count(),
    ]);
    const chat = chatNotifyPrefs(user.chatNotifyPrefs);
    const alerts = alertPrefs(user.alertPrefs);
    return out({
      tryingJaneWithSampleData: isTrialUser(userId),
      janesMessages: {
        sentBy: chat.channel,
        kinds: CHAT_NOTIFY_KINDS.filter((k) => chat.kinds[k]).map(
          (k) => CHAT_NOTIFY_KIND_LABELS[k],
        ),
        atMostADay: CHAT_NOTIFY_DAILY_LIMIT,
        quietHours: `${QUIET_START_HOUR}:00 to ${QUIET_END_HOUR}:00`,
        phonesWithNotificationsOn: devices,
      },
      weeklyEmailAndMonthlyReport: user.digestEnabled,
      alerts: ALERT_TYPES.map((t) => ({ alert: ALERT_LABELS[t].label, delivery: alerts[t] })),
      timezone: user.timezone,
      twoFactorOn: twoFactor.enabledAt !== null,
      calendarLinkMade: user.calendarCreatedAt !== null,
    });
  }

  return out({ error: `Unknown tool ${name}` });
}
