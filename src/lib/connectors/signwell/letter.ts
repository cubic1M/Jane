// The letter a person signs to let Jane act for them with one company (read connectors, 11-18): who
// they are, the company, the few things Jane may do, until when, and what Jane may never do. Plain
// words for counsel to read before any real person signs one. Pure.

// What a letter can let Jane do: one company, one kind of task. Never money.
export const PERMISSION_ACTS = {
  cancel: "cancel my account or subscription and ask for written confirmation",
  lower_rate: "ask for a lower price or rate on my account",
  dispute: "dispute a charge on my account and follow up on it",
  account_info: "ask for information about my account, such as its balance or its terms",
} as const;
export type PermissionAct = keyof typeof PERMISSION_ACTS;

// A letter lasts a year unless the person picks less; never more than three.
export const PERMISSION_MAX_MONTHS = 36;
export const PERMISSION_DEFAULT_MONTHS = 12;

export type PermissionLetter = {
  signerName: string;
  company: string;
  acts: readonly PermissionAct[];
  // YYYY-MM-DD, the last day it holds.
  until: string;
};

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export function letterHtml(letter: PermissionLetter): string {
  const name = escape(letter.signerName);
  const company = escape(letter.company);
  const acts = letter.acts.map((a) => `<li>${escape(PERMISSION_ACTS[a])}</li>`).join("");
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Permission for Jane</title></head><body>',
    `<h1>Permission for Jane to act for me with ${company}</h1>`,
    `<p>I, ${name}, let Jane, the money app I use, act for me with ${company}, in my name, to:</p>`,
    `<ul>${acts}</ul>`,
    `<p>This holds until ${escape(longDate(letter.until))}. I can take it back at any time, by telling Jane or ${company}.</p>`,
    "<p>Jane may not move my money, open or close any other account, change who owns or can use this account, or share my information for any other reason.</p>",
    "</body></html>",
  ].join("\n");
}
