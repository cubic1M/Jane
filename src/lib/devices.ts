import { ACTIVE_NOW_MINUTES } from "@/config/sessions";

// Devices and sessions (spec step 73): a plain name for the device behind a session, from
// its browser's user agent. Pure, and deliberately rough: "iPhone · Safari" is enough for
// someone to recognize their own phone.

// First match wins, so the more specific names come first (iPads say "Mac OS X" too, and
// Android says "Linux").
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPod/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "Chromebook"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Linux/, "Linux"],
];

// Edge, Opera and Samsung's browser also say "Chrome", and Chrome says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Version\/[\d.]+.*Safari\//, "Safari"],
];

function first(table: [RegExp, string][], text: string): string | null {
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function describeDevice(userAgent: string | null | undefined): string {
  const text = userAgent ?? "";
  const parts = [first(SYSTEMS, text), first(BROWSERS, text)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Unknown device";
}

const MINUTE = 60_000;

// Roughly when a session was last used: "Active now", "3 hours ago", "Yesterday", or a date.
export function lastActiveLabel(at: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - at.getTime()) / MINUTE);
  if (minutes < ACTIVE_NOW_MINUTES) return "Active now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "An hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return at.toISOString().slice(0, 10);
}
