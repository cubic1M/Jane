// The first scan after a bank is linked (the sample person's too): the chat opens as soon as
// there are accounts and transactions, says Jane is still looking, and fills in as the rest
// finishes. These bound how long that state is believed.

// A scan older than this is over, finished or not: the chat then behaves as usual.
export const SCAN_MAX_MINUTES = 5;
// While it runs, the open chat reloads this often, for at most this long.
export const SCAN_REFRESH_MS = 3_000;
export const SCAN_REFRESH_MAX_MS = 120_000;
// Jane's first line, until she has the rest.
export const SCANNING_HELLO =
  "Hi, I'm Jane. I'm still going through your accounts and transactions. What I find will show up here in a moment, so stay on this page.";
export const SCANNING_HELLO_KEY = "hello";
