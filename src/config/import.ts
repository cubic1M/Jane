// Uploading statements on /import: how many months to ask for, and how to download them from
// each bank whose CSV layout Jane reads (src/data-sources/csv/formats.ts). Banks move their
// buttons around, so the steps say what to look for rather than exactly where it is.

// The closed beta's main way in (founder: linking feels scary), said wherever it's offered.
export const UPLOAD_REASSURANCE =
  "Files are read once and never stored, and Jane never sees your bank login.";

// What one upload's files may add up to. The server takes 5 MB per request
// (next.config.ts, serverActions.bodySizeLimit); past it the page crashed (round 4: two 3 MB files
// gave "This page couldn't load"), so /import says so before sending.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function uploadTooBig(bytes: number): string {
  return `These files add up to ${(bytes / 1024 / 1024).toFixed(1)} MB. Upload at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB at a time: fewer files, or fewer months in each.`;
}

// The account choice on /import for "a new account from these files".
export const NEW_ACCOUNT_ID = "new";

// The browser event /import sends when an upload is saved, so the progress chip on the page
// starts following it without a reload (src/components/import-chip.tsx).
export const IMPORT_STARTED_EVENT = "jane:import-started";

// How long the progress chip keeps showing an upload the person hasn't closed.
export const IMPORT_RUN_SHOWN_HOURS = 24;
// How often the chip asks how an upload is getting on.
export const IMPORT_POLL_MS = 1500;

// Monthly charges and bills need a few months to show a pattern.
export const SUGGESTED_UPLOAD_MONTHS = 3;
// Files covering fewer days than this get the "add more months" hint.
export const SUGGESTED_UPLOAD_DAYS = 85;

export type BankDownload = { bank: string; steps: string[] };

export const BANK_DOWNLOADS: readonly BankDownload[] = [
  {
    bank: "Chase",
    steps: [
      "Sign in at chase.com and open the account or card.",
      "Click the download icon above your transactions.",
      'Pick "Spreadsheet (Excel, CSV)" and the last 3 months, then Download.',
    ],
  },
  {
    bank: "Bank of America",
    steps: [
      "Sign in at bankofamerica.com and open the account or card.",
      'Click "Download" above your transactions.',
      'Pick the last 3 months and "Microsoft Excel Format" (a .csv file), then Download.',
    ],
  },
  {
    bank: "Wells Fargo",
    steps: [
      "Sign in at wellsfargo.com and open the account.",
      'Choose "Download Account Activity".',
      'Pick the last 3 months and "Comma Delimited (.csv)", then Download.',
    ],
  },
  {
    bank: "Capital One",
    steps: [
      "Sign in at capitalone.com and open the card or 360 account.",
      'Choose "Download Transactions".',
      "Pick CSV and the last 3 months, then Download.",
    ],
  },
  {
    bank: "Citi",
    steps: [
      "Sign in at citi.com and open the card.",
      "Click the download icon above your transactions.",
      "Pick the last 3 months and CSV, then Download.",
    ],
  },
  {
    bank: "American Express",
    steps: [
      'Sign in at americanexpress.com and open "Statements & Activity".',
      "Click the download icon.",
      "Pick CSV and the statements for the last 3 months, then Download.",
    ],
  },
  {
    bank: "Discover",
    steps: [
      'Sign in at discover.com and open "Activity & Statements".',
      'Choose "Download" for the last 3 months.',
      'Pick "Excel" (a .csv file), then Download.',
    ],
  },
  {
    bank: "Any other bank",
    steps: [
      'Look for "Download", "Export" or "Quicken" next to your transactions.',
      "OFX or QFX (Quicken) works for most banks. A CSV works too: if Jane doesn't know its layout, you pick which column is which.",
    ],
  },
];
