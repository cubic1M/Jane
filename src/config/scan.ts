// The first scan after a bank is linked (the sample person's too): the chat opens as soon as
// there are accounts and transactions, says Jane is still looking, and fills in as the rest
// finishes. These bound how long that state is believed.

// A scan older than this is over, finished or not: the chat then behaves as usual.
export const SCAN_MAX_MINUTES = 5;
// While it runs, the open chat reloads this often, for at most this long.
// How often the open chat asks whether Jane has posted something new, and the slower full
// reload that backs it up.
export const SCAN_PULSE_MS = 1_500;
export const SCAN_SLOW_REFRESH_MS = 15_000;
export const SCAN_REFRESH_MAX_MS = 120_000;
// The first line the scan used to post ("still going through your accounts"): no longer posted
// (the page's loading bar says it instead); older chats leave it out by this text.
export const SCANNING_HELLO =
  "Hi, I'm Jane. I'm still going through your accounts and transactions. What I find will show up here in a moment, so stay on this page.";
