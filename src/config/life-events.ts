// Life-event checklists (spec step 72): the money to-dos that come with moving, a new job
// or a new baby. Organizing only: each item says what to look at, never what to choose.
// Item keys are stored in life_events.checked_items, so never rename one; add a new key.

export const LIFE_EVENT_KINDS = ["moving", "new_job", "new_baby"] as const;

export type LifeEventKind = (typeof LIFE_EVENT_KINDS)[number];

export type LifeEventItem = {
  key: string;
  label: string;
  // A Jane page that helps with this item.
  href?: string;
  linkLabel?: string;
};

export type LifeEventChecklist = {
  title: string;
  intro: string;
  items: readonly LifeEventItem[];
};

export const LIFE_EVENTS: Record<LifeEventKind, LifeEventChecklist> = {
  moving: {
    title: "Moving",
    intro: "The money side of a move, so nothing gets missed in the boxes.",
    items: [
      { key: "bank-address", label: "Update your address with your bank and card companies" },
      {
        key: "internet",
        label: "Cancel or move your internet and TV",
        href: "/report",
        linkLabel: "See your bills",
      },
      { key: "utilities", label: "Set up power, gas and water at the new place, and stop the old" },
      {
        key: "budget",
        label: "Set a moving budget",
        href: "/budgets",
        linkLabel: "Budgets",
      },
      { key: "deposit", label: "Write down when your old security deposit should come back" },
      { key: "mail", label: "Forward your mail with the post office" },
      {
        key: "subscriptions",
        label: "Update the address on subscriptions and deliveries",
        href: "/subscriptions",
        linkLabel: "Subscriptions",
      },
      { key: "insurance", label: "Tell your renters, home or car insurer about the new address" },
    ],
  },
  new_job: {
    title: "New job",
    intro: "Things to set up when the paychecks change.",
    items: [
      {
        key: "paycheck",
        label: "Check the first paycheck arrived in the right account",
        href: "/transactions",
        linkLabel: "Transactions",
      },
      { key: "direct-deposit", label: "Send your new employer your direct deposit details" },
      {
        key: "retirement",
        label: "Find the 401(k) enrollment papers from HR and note the sign-up deadline",
      },
      { key: "benefits", label: "Note the deadline to sign up for health and other benefits" },
      { key: "old-plan", label: "Write down where your old job's retirement account is held" },
      {
        key: "emergency-fund",
        label: "Update your emergency fund goal for your new pay",
        href: "/goals",
        linkLabel: "Goals",
      },
      {
        key: "budget",
        label: "Update your budgets for the new take-home pay",
        href: "/budgets",
        linkLabel: "Budgets",
      },
      {
        key: "commute",
        label: "Add up the new commute costs",
        href: "/insights",
        linkLabel: "Spending",
      },
    ],
  },
  new_baby: {
    title: "New baby",
    intro: "Money to-dos for the months around a new arrival.",
    items: [
      {
        key: "goal",
        label: "Start a baby savings goal",
        href: "/goals",
        linkLabel: "Goals",
      },
      { key: "health-plan", label: "Add the baby to your health plan before the deadline" },
      {
        key: "insurance",
        label: "Look over your insurance policies",
        href: "/report",
        linkLabel: "Your report",
      },
      {
        key: "budget",
        label: "Set a budget for diapers, formula and childcare",
        href: "/budgets",
        linkLabel: "Budgets",
      },
      { key: "leave", label: "Write down your parental leave dates and what pay to expect" },
      { key: "beneficiaries", label: "Update the beneficiaries on your accounts" },
      {
        key: "papers",
        label: "Keep the birth certificate and Social Security card somewhere safe",
      },
      {
        key: "subscriptions",
        label: "Check which subscriptions you'll still use",
        href: "/subscriptions",
        linkLabel: "Subscriptions",
      },
    ],
  },
};

export const isLifeEventKind = (value: unknown): value is LifeEventKind =>
  typeof value === "string" && (LIFE_EVENT_KINDS as readonly string[]).includes(value);
