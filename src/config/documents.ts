// Insurance policies, warranties and receipts (spec step 68, src/lib/documents).

export const DOCUMENT_KINDS = {
  insurance_policy: "Insurance policy",
  warranty: "Warranty",
  receipt: "Receipt",
  other: "Something else",
} as const;

export type DocumentKind = keyof typeof DOCUMENT_KINDS;

export const POLICY_TYPES = {
  auto: "Car",
  home: "Home",
  renters: "Renters",
  life: "Life",
  health: "Health",
  other: "Other",
} as const;

export type PolicyType = keyof typeof POLICY_TYPES;

// How often the premium is paid, and how many times that is a year.
export const PREMIUM_FREQUENCIES = {
  monthly: { label: "a month", perYear: 12 },
  quarterly: { label: "every 3 months", perYear: 4 },
  semiannual: { label: "every 6 months", perYear: 2 },
  yearly: { label: "a year", perYear: 1 },
} as const;

export type PremiumFrequency = keyof typeof PREMIUM_FREQUENCIES;

// The only file types we keep, each with the bytes its files start with. A file must
// match both its stated type and these bytes.
export const DOCUMENT_TYPES = {
  "application/pdf": { label: "PDF", extension: "pdf" },
  "image/jpeg": { label: "JPEG", extension: "jpg" },
  "image/png": { label: "PNG", extension: "png" },
  "image/webp": { label: "WebP", extension: "webp" },
} as const;

export type DocumentContentType = keyof typeof DOCUMENT_TYPES;

// Per file. Vercel refuses request bodies over 4.5 MB, so a larger limit here would only
// fail later with a worse message. Server actions allow 5 MB (next.config.ts).
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

// Files kept per person.
export const MAX_DOCUMENTS = 50;

// Longest file name and fact text we keep, in characters.
export const MAX_FILE_NAME_LENGTH = 120;
export const MAX_FACT_LENGTH = 160;

// A receipt's usual return window, for the deadlines list (spec step 71): most US stores
// take returns for about 30 days.
export const RETURN_WINDOW_DAYS = 30;

// Dates outside these years are treated as misread.
export const DOCUMENT_YEARS = { min: 1990, max: 2100 } as const;
