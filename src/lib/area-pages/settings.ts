import { buildAreaTree, firstSentences, type AreaItem, type AreaTree } from "./tree";
import { isHiddenPage } from "@/config/hidden-pages";

// Settings as a tree (docs/design/area-pages.md): Settings → its branches (banks and files,
// how much Jane does, how Jane reaches you, what Jane knows, home and household, sign-in and
// privacy, your data) → one item per setting, each with what it's set to as its figure. Pure:
// the page loads what it always did and hands it here; each item's form stays in the page.

export const SETTINGS_BRANCHES = {
  banks: "Banks and files",
  autopilot: "How much Jane does",
  notify: "How Jane reaches you",
  memory: "What Jane knows",
  household: "Home and household",
  security: "Sign-in and privacy",
  data: "Your data",
} as const;
export type SettingsBranch = keyof typeof SETTINGS_BRANCHES;

export const itemId = (branch: SettingsBranch, key: string) => `${branch}:${key}`;

// The page's old section anchors (#alerts, #two-factor, ...), linked from emails, Jane's
// messages and other pages, to the item that now holds each. #banks and #your-accounts open
// the first bank, so its Refresh and Disconnect are there.
export const SETTINGS_ANCHORS: Readonly<Record<string, string>> = {
  accounts: "banks",
  banks: "banks",
  "your-accounts": "banks",
  // While a page is hidden in the read-only beta (src/config/hidden-pages.ts), its item isn't in
  // the tree, so its anchor opens the branch.
  household: isHiddenPage("/household") ? "household" : itemId("household", "household"),
  "where-you-live": itemId("household", "state"),
  notifications: "notify",
  "jane-messages": itemId("notify", "messages"),
  "asking-less": itemId("notify", "asking"),
  email: itemId("notify", "email"),
  alerts: itemId("notify", "alerts"),
  autopilot: itemId("autopilot", "level"),
  sectors: itemId("autopilot", "sectors"),
  rules: itemId("autopilot", "rules"),
  remembers: itemId("memory", "told"),
  privacy: "security",
  "two-factor": itemId("security", "two-factor"),
  sessions: itemId("security", "sessions"),
  "team-access": isHiddenPage("/settings/team-access") ? "security" : itemId("security", "access"),
  calendar: itemId("security", "calendar"),
  "your-data": itemId("data", "download"),
  delete: itemId("data", "delete"),
};

export type SettingsTreeInput = {
  banks: { id: string; name: string; updated: string; accounts: number; needsSignIn: boolean }[];
  // Accounts imported from a file, and the books check's words when the file has ended.
  imports: { id: string; name: string; lastImport: string; ended: string | null }[];
  autopilot: string | null;
  sectorsOn: number;
  sectors: number;
  rulesOn: number;
  // How Jane's messages go out ("Phone", "Email", "Phone and email", "Off").
  channel: string;
  alertsOn: number;
  alerts: number;
  digest: boolean;
  remembered: number;
  state: string | null;
  owned: number;
  documents: number;
  twoFactor: boolean;
  calendar: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const asLabel = (name: string) => name.trim().split(/\s+/).slice(0, 6).join(" ");

// #banks and #your-accounts open the first bank or file, when there is one.
export function anchorFocus(anchor: string, tree: AreaTree): string | undefined {
  const to = SETTINGS_ANCHORS[anchor];
  if (to !== "banks") return to;
  return tree.tree.branches.find((b) => b.id === "banks")?.items[0]?.id ?? to;
}

export function settingsTree(input: SettingsTreeInput): AreaTree {
  const item = (branch: SettingsBranch, key: string, rest: Omit<AreaItem, "id">): AreaItem => ({
    id: itemId(branch, key),
    ...rest,
    label: asLabel(rest.label),
    summary: firstSentences(rest.summary),
  });

  const banks = [
    ...input.banks.map((b) =>
      item("banks", `item-${b.id}`, {
        label: b.name,
        line: `Updated ${b.updated}`,
        status: b.needsSignIn ? "act" : "good",
        figure: b.needsSignIn ? "Sign in again" : plural(b.accounts, "account"),
        summary: b.needsSignIn
          ? "Your bank needs you to sign in again before I can read new transactions."
          : `${plural(b.accounts, "account")} linked, updated ${b.updated}.`,
      }),
    ),
    ...input.imports.map((a) =>
      item("banks", `csv-${a.id}`, {
        label: a.name,
        line: `Last import ${a.lastImport}`,
        status: a.ended ? "look" : "good",
        figure: a.ended ? "Data ended" : "Imported",
        summary: a.ended ?? `Imported from a file, last on ${a.lastImport}.`,
      }),
    ),
    item("banks", "add", {
      label: "Add a bank or a file",
      summary:
        input.banks.length + input.imports.length === 0
          ? "No banks linked. Link one, or import a statement file."
          : "Link another bank, or import a statement file.",
    }),
  ];

  const autopilot = [
    item("autopilot", "level", {
      label: "How much Jane does alone",
      status: input.autopilot ? "good" : "look",
      figure: input.autopilot ?? "Not chosen",
      summary: input.autopilot
        ? `Now: ${input.autopilot}. Pick a level to change it.`
        : "You haven't chosen yet, so Jane asks before everything.",
    }),
    item("autopilot", "sectors", {
      label: "Area by area",
      figure: `${input.sectorsOn} of ${input.sectors}`,
      summary: `Jane may act on its own in ${plural(input.sectorsOn, "area")}, up to the caps you set.`,
    }),
    item("autopilot", "rules", {
      label: "Standing rules",
      figure: `${input.rulesOn} on`,
      summary: "Things Jane may do without asking each time.",
    }),
  ];

  const notify = [
    item("notify", "messages", {
      label: "Messages from Jane",
      figure: input.channel,
      summary: "How Jane's messages reach you, with buttons to answer right there.",
    }),
    item("notify", "alerts", {
      label: "Alerts",
      figure: `${input.alertsOn} of ${input.alerts}`,
      summary: "What Jane checks after every update from your bank, and how each one reaches you.",
    }),
    item("notify", "email", {
      label: "Weekly email",
      figure: input.digest ? "On" : "Off",
      summary: "Your week in money, and the monthly report, by email.",
    }),
    item("notify", "asking", {
      label: "Asking less",
      summary: "When Jane asks you things, and what it stopped bringing up.",
    }),
  ];

  const memory = [
    item("memory", "told", {
      label: "What Jane remembers",
      figure: String(input.remembered),
      summary: "What you've told Jane in the chat, and suggestions you asked it not to make again.",
    }),
    item("memory", "style", {
      label: "How Jane talks",
      summary: "Short or detailed, plain words or numbers.",
    }),
  ];

  const household = [
    // Hidden in the read-only beta (src/config/hidden-pages.ts).
    ...(isHiddenPage("/household")
      ? []
      : [
          item("household", "household", {
            label: "Household",
            summary: "Share chosen accounts with a partner, read-only.",
          }),
        ]),
    item("household", "state", {
      label: "Where you live",
      figure: input.state ?? "Not set",
      summary: "Some offers, like savings accounts from partners, are only in some states.",
    }),
    item("household", "owned", {
      label: "Things you own",
      figure: String(input.owned),
      summary: "Your home, your car and anything else of value, at what you say it's worth.",
    }),
    item("household", "documents", {
      label: "Policies and receipts",
      figure: String(input.documents),
      summary: "Your policies, warranties and receipts, encrypted.",
    }),
  ];

  const security = [
    item("security", "two-factor", {
      label: "Two-factor sign-in",
      figure: input.twoFactor ? "On" : "Off",
      summary: input.twoFactor
        ? "Each new sign-in asks for a code from your authenticator app."
        : "Optional extra protection: signing in also asks for a code from an app on your phone.",
    }),
    item("security", "sessions", {
      label: "Where you're signed in",
      summary: "Don't recognize one? Sign it out; it stops working straight away.",
    }),
    ...(isHiddenPage("/settings/team-access")
      ? []
      : [
          item("security", "access", {
            label: "Who saw my data",
            summary: "Every time our team or Jane's agent looked at or acted on your data.",
          }),
        ]),
    item("security", "calendar", {
      label: "Money calendar",
      figure: input.calendar ? "On" : "Off",
      summary: "Your bills and deadlines in your own calendar app.",
    }),
  ];

  const data = [
    item("data", "download", {
      label: "Download my data",
      summary: "A copy of everything we hold about you, as a JSON file.",
    }),
    item("data", "delete", {
      label: "Delete all my data",
      summary:
        "We disconnect every linked bank and permanently delete your account, transactions, findings and history. This can't be undone.",
    }),
  ];

  const branches: Record<SettingsBranch, AreaItem[]> = {
    banks,
    autopilot,
    notify,
    memory,
    household,
    security,
    data,
  };
  return buildAreaTree({
    key: "settings",
    label: "Settings",
    sub: ({ urgent, look }) =>
      urgent > 0
        ? `${urgent} urgent · ${look} to look at`
        : look > 0
          ? `${look} to look at`
          : "All good",
    branches: (Object.keys(SETTINGS_BRANCHES) as SettingsBranch[]).map((id) => ({
      id,
      label: SETTINGS_BRANCHES[id],
      items: branches[id],
    })),
  });
}
